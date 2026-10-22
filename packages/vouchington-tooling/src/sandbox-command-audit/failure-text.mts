import type { ClassifyFailure, FailureKind } from './types.mts'

const E2BIG_PATTERN = /\bE2BIG\b/

// Deliberately conservative: `is_error: true` on a Bash tool_result also covers ordinary
// application failures (a failed test run, a grep with no matches), so only known
// permission/access signatures count. ECONNREFUSED is excluded on purpose: it is the generic
// "nothing is listening" error and carries no permission semantics.
const GENUINE_FAILURE_PATTERNS = [
  /operation not permitted/i,
  /permission denied/i,
  /\bEACCES\b/,
  /\bEPERM\b/,
  /could not start .*sandbox/i,
]

// A timeout against a loopback target is a sandbox's signature for a silently dropped
// connection. Requiring both tokens keeps it narrow: a bare "timed out" (a slow test run) or a
// bare loopback mention carries no sandbox signal on its own.
const TIMEOUT_PATTERN = /\bETIMEDOUT\b|\btimed out\b/i
const LOOPBACK_PATTERN = /\blocalhost\b|\b127\.0\.0\.1\b|(?<![\w:])::1(?!\w)/i

/**
 * Sorts a failed Bash result into `e2big`, a caller-defined kind, `genuine`, or nothing. The
 * caller's rule sits between the E2BIG check and the generic signatures, so it can claim a failure
 * that would otherwise count as a genuine bypass candidate.
 */
export function classifyFailureText(
  command: string | undefined,
  text: string,
  source: 'claude' | 'codex',
  classify?: ClassifyFailure,
): FailureKind | undefined {
  if (E2BIG_PATTERN.test(text)) return 'e2big'
  const custom = classify?.(command, text, source)
  if (custom !== undefined) return custom
  if (GENUINE_FAILURE_PATTERNS.some((pattern) => pattern.test(text))) return 'genuine'
  if (TIMEOUT_PATTERN.test(text) && LOOPBACK_PATTERN.test(text)) return 'genuine'
  return undefined
}
