import type { RetryContext, RetryDecision, RetryRule, RetryTarget } from './types.mts'

export type NoMatchReason = 'no-rule' | 'invalid-rule' | 'invalid-target' | 'missing-target'

export type DecisionResult =
  | {
      decision: Exclude<RetryDecision, 'rerun'>
      matchedRule: string
    }
  | { decision: 'rerun'; matchedRule: string; targetName: string }
  | {
      decision: 'no-match'
      matchedRule: string
      reason: NoMatchReason
    }

export interface EvaluateRulesOptions {
  afterRuleEvaluated?: (context: RetryContext, rule: RetryRule) => Promise<void> | void
  /** Defaults to `no-match`. Use `dispatch` when unmatched work should leave the retry engine. */
  unmatchedDecision?: 'no-match' | 'dispatch'
}

function normalizedAttempt(context: RetryContext, rule: RetryRule): number {
  const sharedAttempt = context.retryAttempt ?? context.runAttempt
  return rule.decision === undefined || rule.decision === 'rerun'
    ? (context.retryAttempts?.get(rule.id) ?? sharedAttempt)
    : sharedAttempt
}

function resolveTargetName(
  target: RetryTarget | undefined,
  context: RetryContext,
): { targetName: string; reason?: never } | { targetName?: never; reason: NoMatchReason } {
  if (target == null || typeof target !== 'object') return { reason: 'invalid-target' }
  let targetName: unknown
  try {
    targetName = 'targetName' in target ? target.targetName : target.resolveTargetName(context)
  } catch {
    return { reason: 'invalid-target' }
  }
  if (typeof targetName !== 'string') {
    return { reason: targetName == null ? 'missing-target' : 'invalid-target' }
  }
  if ('targetFamily' in target) {
    if (typeof target.targetFamily !== 'string' || target.targetFamily.length === 0) {
      return { reason: 'invalid-target' }
    }
    if (!targetName.startsWith(target.targetFamily)) {
      return { reason: 'invalid-target' }
    }
  }
  if (targetName.length === 0) return { reason: 'missing-target' }
  if (!context.targetNames?.has(targetName)) return { reason: 'missing-target' }
  return { targetName }
}

export async function decide(
  context: RetryContext,
  rules: readonly RetryRule[],
  options: EvaluateRulesOptions = {},
): Promise<DecisionResult> {
  for (const rule of rules) {
    const attempt = normalizedAttempt(context, rule)
    if (!Number.isSafeInteger(attempt) || attempt < 1 || !Number.isSafeInteger(rule.maxAttempts)) {
      return { decision: 'no-match', matchedRule: rule.id, reason: 'invalid-rule' }
    }
    if (rule.maxAttempts < attempt) continue

    const matched = await rule.match(context)
    await options.afterRuleEvaluated?.(context, rule)
    if (!matched) continue

    if (rule.decision !== undefined && rule.decision !== 'rerun') {
      return { decision: rule.decision, matchedRule: rule.id }
    }
    if (rule.retryTarget === undefined) {
      return { decision: 'rerun', matchedRule: rule.id, targetName: '' }
    }
    const resolved = resolveTargetName(rule.retryTarget, context)
    if (resolved.targetName === undefined) {
      return { decision: 'no-match', matchedRule: rule.id, reason: resolved.reason }
    }
    return { decision: 'rerun', matchedRule: rule.id, targetName: resolved.targetName }
  }
  if (options.unmatchedDecision === 'dispatch') {
    return { decision: 'dispatch', matchedRule: '' }
  }
  return { decision: 'no-match', matchedRule: '', reason: 'no-rule' }
}
