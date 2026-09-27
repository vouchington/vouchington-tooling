import { splitTopLevel, hasTopLevelMixedOperators } from './condition-split.mts'
/**
 * Conservative GitHub Actions `if:` condition comparison.
 * Deliberately conservative: a condition shape this can't reason about is treated as NOT entailed
 * (readiness step rejected) rather than guessed at, since a false "safe" verdict is the real risk.
 */

/**
 * Splits `expression` on top-level occurrences of `operator` — one inside parens or a quoted
 * string doesn't count as top-level.
 */
function stripOuterParens(expression: string): string {
  const trimmed = expression.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return trimmed
  let depth = 0
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === '(') depth += 1
    else if (trimmed[index] === ')') {
      depth -= 1
      if (depth === 0 && index !== trimmed.length - 1) return trimmed
    }
  }
  return trimmed.slice(1, -1).trim()
}

/**
 * GitHub Actions status functions carry meaningfully different restrictions:
 * - omitted `if:` / explicit `success()` — the implicit default, skipped once any prior step in the
 *   job has failed.
 * - `always()` — no restriction at all; runs regardless of prior failures.
 * - `failure()` / `cancelled()` — the opposite of the default, only runs *after* a prior failure.
 * A guard step is only a real early-fail gate for a consumer if the guard's status restriction is
 * at least as permissive as the consumer's — see `conditionEntails` below for how this is used.
 */
type ImpliedStatus = 'default' | 'always' | 'other'

const STATUS_CLAUSES: Record<string, ImpliedStatus> = {
  'success()': 'default',
  'always()': 'always',
  'failure()': 'other',
  'cancelled()': 'other',
}

/**
 * Recognizes a clause as a status-function check even when wrapped — a single layer of parens
 * (`(cancelled())`) or a leading negation (`!cancelled()`, this repo's common form) — not just an
 * exact bare match. Negation flips a status function's permissiveness in a way this file can't
 * cleanly reason about (`!cancelled()` runs on both success and failure, a strict superset of the
 * default success()-only restriction), so any negated form is conservatively classified `other`
 * regardless of which function it negates — the same "can't reason about it, reject" fallback used
 * elsewhere in this file.
 */
function classifyStatusClause(clause: string): ImpliedStatus | undefined {
  const direct = STATUS_CLAUSES[clause] ?? STATUS_CLAUSES[stripOuterParens(clause)]
  if (direct) return direct
  if (!clause.startsWith('!')) return undefined
  const negated = stripOuterParens(clause.slice(1).trim())
  return STATUS_CLAUSES[negated] ? 'other' : undefined
}

/**
 * True when `clause` — or its single paren layer — is a top-level `||` where at least one branch
 * is itself a status function (including wrapped forms, see `classifyStatusClause`). A shape like
 * `always() || vars.FORCE == 'true'` mixes a status restriction into what looks like an ordinary
 * clause — it can't be folded into the condition's one overall `ImpliedStatus`, nor matched as an
 * ordinary clause (which needs an identical consumer-side string). Callers reject it outright.
 */
function hasStatusFunctionInOrBranch(clause: string): boolean {
  const branches = splitTopLevel(stripOuterParens(clause), '||')
  if (branches.length <= 1) return false
  return branches.some((branch) => classifyStatusClause(branch.trim()) !== undefined)
}

type ParsedCondition = { status: ImpliedStatus; clauses: string[]; ambiguous: boolean }

/**
 * True when `expression` contains both a top-level `&&` and a top-level `||` — outside any
 * parens or quoted string. GitHub Actions binds `&&` tighter than `||`, so `A || B && G` means
 * `A || (B && G)`, not `(A || B) && G` — naively AND-splitting such a mix on `&&` would silently
 * misread its grouping and could accept a guard that doesn't actually cover every path the
 * consumer runs on. A condition mixing both operators without full parenthesization is one this
 * file cannot safely reason about — see the conservative-rejection policy in the file header.
 */
function parseCondition(condition: string): ParsedCondition {
  const trimmed = condition.trim()
  if (hasTopLevelMixedOperators(trimmed)) return { status: 'other', clauses: [], ambiguous: true }
  const allClauses = trimmed === '' ? [] : splitTopLevel(trimmed, '&&')
  const statuses = new Set<ImpliedStatus>()
  const clauses: string[] = []
  for (const clause of allClauses) {
    if (hasStatusFunctionInOrBranch(clause))
      return { status: 'other', clauses: [], ambiguous: true }
    const status = classifyStatusClause(clause)
    if (status) statuses.add(status)
    else clauses.push(clause)
  }
  if (statuses.size === 0) return { status: 'default', clauses, ambiguous: false }
  if (statuses.size > 1) return { status: 'other', clauses, ambiguous: false }
  return { status: [...statuses][0]!, clauses, ambiguous: false }
}

/**
 * True when `guardCondition` is guaranteed to hold whenever `consumerCondition` does, so a step
 * gated by `guardCondition` cannot be skipped on any execution path that reaches a step gated by
 * `consumerCondition`. Each of the guard's top-level `&&` clauses must either be one of the
 * consumer's own clauses, or — when the guard clause is itself a `(a || b)` group — the consumer
 * must require one of that group's alternatives. That second case is what a shared trailing gate
 * ANDed onto an OR of per-consumer clauses produces: `(A || B) && G` guarding two steps gated
 * `A && G` and `B && G` respectively — the shape a shared secret takes when it backs two
 * differently-gated consumer steps in the same job.
 *
 * Clauses alone aren't enough: a guard with the implicit `success()`/default status restriction is
 * skipped on any path where an earlier step already failed, so it cannot protect a consumer gated
 * `always()` or `failure()` that still runs on that same path. `other` (e.g. `failure()`,
 * `cancelled()`) is rejected outright as a guard status — this check can't reason about whether the
 * guard and consumer agree on which failure path they run on, and a false "safe" verdict is the real
 * risk (see file header). An `always()` guard has no restriction, so it entails any consumer status.
 * Either side being `ambiguous` (an unparenthesized `&&`/`||` mix — see `hasTopLevelMixedOperators`)
 * rejects entailment outright, since its clauses can't be trusted to reflect real precedence.
 */
export function conditionEntails(guardCondition: string, consumerCondition: string): boolean {
  const guard = parseCondition(guardCondition)
  if (guard.ambiguous || guard.status === 'other') return false
  const consumer = parseCondition(consumerCondition)
  if (consumer.ambiguous) return false
  if (consumer.status !== 'default' && guard.status !== 'always') return false

  const consumerClauses = new Set(consumer.clauses)
  return guard.clauses.every((guardClause) => {
    if (consumerClauses.has(guardClause)) return true
    const inner = stripOuterParens(guardClause)
    if (inner === guardClause) return false
    const branches = splitTopLevel(inner, '||')
    return branches.length > 1 && branches.some((branch) => consumerClauses.has(branch))
  })
}
