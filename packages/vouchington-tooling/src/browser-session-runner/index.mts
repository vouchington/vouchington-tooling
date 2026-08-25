import type { ChildProcess } from 'node:child_process'

import { boundPendingLine, splitCompleteLines } from '../process-line-buffer/index.mts'

export type BrowserSessionEvent = 'startup' | 'semantic'
export type BrowserSessionExit = { code: number | null; signal: NodeJS.Signals | null }
export type BrowserSessionResult = {
  attempts: number
  deadlineExceeded: boolean
  diagnosticTail: string
  exit: BrowserSessionExit
  reason: 'exit' | 'parent-signal' | 'semantic-stall' | 'startup-stall' | 'deadline'
  startupProgress: boolean
  semanticProgress: boolean
}
export type BrowserSessionProcess = Pick<ChildProcess, 'kill'> & {
  processGroupId: number
  on(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown
  stderr?: { on(event: 'data', listener: (chunk: string | Buffer) => void): unknown }
  stdout?: { on(event: 'data', listener: (chunk: string | Buffer) => void): unknown }
}
export type BrowserSessionDeps = {
  clearInterval(handle: unknown): void
  clearTimeout(handle: unknown): void
  killProcessGroup(pid: number, signal: NodeJS.Signals): void
  now(): number
  offParentSignal(signal: NodeJS.Signals, listener: () => void): void
  onParentSignal(signal: NodeJS.Signals, listener: () => void): void
  setInterval(callback: () => void, ms: number): unknown
  setTimeout(callback: () => void, ms: number): unknown
}
export type BrowserSessionOptions = {
  attempts: number
  classifyExit(
    exit: BrowserSessionExit,
    result: Omit<BrowserSessionResult, 'attempts'>,
  ): 'retry' | 'return'
  deadlineMs: number
  diagnosticTailBytes?: number
  graceMs: number
  onLine(line: string): BrowserSessionEvent | undefined
  semanticStallMs: number
  start(attempt: number): BrowserSessionProcess
  startupStallMs: number
  watchdogIntervalMs?: number
}

const defaultDeps: BrowserSessionDeps = {
  clearInterval,
  clearTimeout,
  killProcessGroup: (processGroupId, signal) => process.kill(-processGroupId, signal),
  now: Date.now,
  offParentSignal: (signal, listener) => process.off(signal, listener),
  onParentSignal: (signal, listener) => process.once(signal, listener),
  setInterval,
  setTimeout,
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
    if (last.reason !== 'exit' || options.classifyExit(last.exit, omitAttempts(last)) !== 'retry')
      return { ...last, attempts: attempt }
  }
  if (attempts === options.attempts) return { ...last!, attempts }
  return { ...(last ?? expiredResult()), attempts, deadlineExceeded: true, reason: 'deadline' }
}

function validateOptions(options: BrowserSessionOptions): void {
  const positiveIntegers: Array<[string, number]> = [
    ['attempts', options.attempts],
    ['deadlineMs', options.deadlineMs],
    ['graceMs', options.graceMs],
    ['semanticStallMs', options.semanticStallMs],
    ['startupStallMs', options.startupStallMs],
    ['watchdogIntervalMs', options.watchdogIntervalMs ?? 1000],
    ['diagnosticTailBytes', options.diagnosticTailBytes ?? 4096],
  ]
  for (const [name, value] of positiveIntegers) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`)
  }
}

function omitAttempts(result: BrowserSessionResult): Omit<BrowserSessionResult, 'attempts'> {
  const { attempts: _attempts, ...withoutAttempts } = result
  return withoutAttempts
}

function expiredResult(): BrowserSessionResult {
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

function runAttempt(
  options: BrowserSessionOptions,
  deps: BrowserSessionDeps,
  deadline: number,
  attempt: number,
) {
  return new Promise<BrowserSessionResult>((resolve) => {
    const startedAt = deps.now()
    const process = options.start(attempt)
    if (!Number.isSafeInteger(process.processGroupId) || process.processGroupId <= 0)
      throw new RangeError('processGroupId must be positive')
    let tail = ''
    let startupProgress = false
    let semanticProgress = false
    let lastProgress = startedAt
    let reason: BrowserSessionResult['reason'] = 'exit'
    let complete = false
    let killTimer: unknown
    const listeners: Array<() => void> = []
    const finish = (exit: BrowserSessionExit) => {
      if (complete) return
      complete = true
      deps.clearInterval(watchdog)
      if (killTimer) deps.clearTimeout(killTimer)
      for (const remove of listeners) remove()
      resolve({
        attempts: 0,
        deadlineExceeded: reason === 'deadline',
        diagnosticTail: tail,
        exit,
        reason,
        semanticProgress,
        startupProgress,
      })
    }
    const terminate = (nextReason: BrowserSessionResult['reason']) => {
      if (reason !== 'exit') return
      reason = nextReason
      killTimer = deps.setTimeout(() => {
        deps.killProcessGroup(process.processGroupId, 'SIGKILL')
        process.kill('SIGKILL')
      }, options.graceMs)
      deps.killProcessGroup(process.processGroupId, 'SIGTERM')
      process.kill('SIGTERM')
    }
    const consume = () => {
      let pending = ''
      return (chunk: string | Buffer) => {
        tail = boundPendingLine(
          (tail + String(chunk)).slice(-(options.diagnosticTailBytes ?? 4096)),
        )
        const split = splitCompleteLines(pending + String(chunk))
        pending = boundPendingLine(split.pending)
        for (const line of split.complete) {
          const event = options.onLine(line)
          if (event === 'startup') startupProgress = true
          if (event === 'semantic') semanticProgress = true
          if (event) lastProgress = deps.now()
        }
      }
    }
    for (const stream of [process.stdout, process.stderr]) stream?.on('data', consume())
    const watchdog = deps.setInterval(() => {
      const now = deps.now()
      if (now >= deadline - options.graceMs) return terminate('deadline')
      if (!startupProgress && now - startedAt >= options.startupStallMs)
        return terminate('startup-stall')
      if (startupProgress && now - lastProgress >= options.semanticStallMs)
        terminate('semantic-stall')
    }, options.watchdogIntervalMs ?? 1000)
    for (const signal of ['SIGINT', 'SIGTERM'] as NodeJS.Signals[]) {
      const listener = () => terminate('parent-signal')
      deps.onParentSignal(signal, listener)
      listeners.push(() => deps.offParentSignal(signal, listener))
    }
    process.on('close', (code, signal) => finish({ code, signal }))
  })
}
