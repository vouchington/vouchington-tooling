import type { BrowserSessionResult } from './types.mts'

export function expiredResult(): BrowserSessionResult {
  return {
    attempts: 0,
    deadlineExceeded: true,
    diagnosticTail: '',
    exit: { code: null, signal: null },
    reason: 'deadline',
    semanticProgress: false,
    startupProgress: false,
  }
}
