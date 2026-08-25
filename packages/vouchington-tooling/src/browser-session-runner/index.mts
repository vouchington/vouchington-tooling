import { runAttempt } from './attempt.mts'
import { expiredResult } from './result.mts'
import { isProcessGroupAlive, waitForProcessGroupExit } from './process-group.mts'
import type { BrowserSessionDeps, BrowserSessionOptions, BrowserSessionResult } from './types.mts'

export type {
  BrowserSessionDeps,
  BrowserSessionEvent,
  BrowserSessionExit,
  BrowserSessionOptions,
  BrowserSessionProcess,
  BrowserSessionResult,
} from './types.mts'

const defaultDeps: BrowserSessionDeps = {
  clearInterval,
  clearTimeout,
  isProcessGroupAlive,
  killProcessGroup: (processGroupId, signal) => {
    try {
      process.kill(-processGroupId, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  },
  now: () => performance.now(),
  offParentSignal: (signal, listener) => process.off(signal, listener),
  onParentSignal: (signal, listener) => process.on(signal, listener),
  setInterval,
  setTimeout,
  waitForProcessGroupExit,
}

export async function runBrowserSession(
  options: BrowserSessionOptions,
  deps: BrowserSessionDeps = defaultDeps,
): Promise<BrowserSessionResult> {
  validateOptions(options)
  const deadline = deps.now() + options.deadlineMs
  let last: BrowserSessionResult | undefined
  let attempts = 0
  for (let attempt = 1; attempt <= options.attempts && deps.now() < deadline; attempt += 1) {
    attempts = attempt
    last = await runAttempt(options, deps, deadline, attempt)
    if (
      last.reason === 'parent-signal' ||
      last.reason === 'deadline' ||
      options.classifyExit(last.exit, omitAttempts(last)) !== 'retry'
    )
      return { ...last, attempts }
  }
  if (attempts === options.attempts) return { ...last!, attempts }
  return { ...(last ?? expiredResult()), attempts, deadlineExceeded: true, reason: 'deadline' }
}

function validateOptions(options: BrowserSessionOptions): void {
  const maxTimerDelay = 2_147_483_647
  for (const [name, value] of [
    ['attempts', options.attempts],
    ['deadlineMs', options.deadlineMs],
    ['graceMs', options.graceMs],
    ['semanticStallMs', options.semanticStallMs],
    ['startupStallMs', options.startupStallMs],
    ['watchdogIntervalMs', options.watchdogIntervalMs ?? 1000],
  ] as Array<[string, number]>) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maxTimerDelay)
      throw new RangeError(`${name} must be a positive Node timer delay`)
  }
  const tailBytes = options.diagnosticTailBytes ?? 4096
  if (!Number.isSafeInteger(tailBytes) || tailBytes <= 0)
    throw new RangeError('diagnosticTailBytes must be positive')
}

function omitAttempts({ attempts: _attempts, ...result }: BrowserSessionResult) {
  return result
}
