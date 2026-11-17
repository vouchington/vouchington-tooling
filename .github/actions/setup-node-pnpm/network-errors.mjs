// Classifies a failed `pnpm install` as a transient network/registry failure worth one more
// attempt. Everything else (lockfile mismatch, 404, integrity, lifecycle script) fails at once.
const RETRYABLE_PATTERNS = [
  /ERR_PNPM_META_FETCH_FAIL/u,
  /ERR_PNPM_FETCH_(?:408|429|5\d\d)/u,
  /ETIMEDOUT/u,
  /ESOCKETTIMEDOUT/u,
  /ECONNRESET/u,
  /ECONNREFUSED/u,
  /EAI_AGAIN/u,
  /UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET)/u,
  /socket hang up/u,
]

// A retryable pattern can also appear inside one of these failures, so they always win.
const FATAL_PATTERNS = [
  /ERR_PNPM_FETCH_4(?!08|29)\d\d/u,
  /ERR_PNPM_(?:OUTDATED_LOCKFILE|LOCKFILE_\w+|NO_MATCHING_VERSION|TARBALL_INTEGRITY|LIFECYCLE\w*)/u,
  /ELIFECYCLE/u,
]

// Returns the first matching retryable code, or undefined when the failure is not retryable.
export function networkFailureReason(output) {
  if (FATAL_PATTERNS.some((pattern) => pattern.test(output))) return undefined
  for (const pattern of RETRYABLE_PATTERNS) {
    const match = pattern.exec(output)
    if (match) return match[0]
  }
  return undefined
}
