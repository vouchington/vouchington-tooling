import { StringDecoder } from 'node:string_decoder'

import { boundPendingLine, splitCompleteLines } from '../process-line-buffer/index.mts'
import { expiredResult } from './result.mts'
import { tailText } from './tail.mts'
import type {
  BrowserSessionDeps,
  BrowserSessionExit,
  BrowserSessionOptions,
  BrowserSessionResult,
} from './types.mts'

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
  killProcessGroup: (processGroupId, signal) => {
    try {
      process.kill(-processGroupId, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  },
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
  for (const [name, value] of [
    ['attempts', options.attempts],
    ['deadlineMs', options.deadlineMs],
    ['graceMs', options.graceMs],
    ['semanticStallMs', options.semanticStallMs],
    ['startupStallMs', options.startupStallMs],
    ['watchdogIntervalMs', options.watchdogIntervalMs ?? 1000],
    ['diagnosticTailBytes', options.diagnosticTailBytes ?? 4096],
  ] as Array<[string, number]>) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`)
  }
}

function omitAttempts({ attempts: _attempts, ...result }: BrowserSessionResult) {
  return result
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
    if (!Number.isSafeInteger(process.processGroupId) || process.processGroupId <= 0) {
      try {
        process.kill('SIGKILL')
      } catch {}
      throw new RangeError('processGroupId must be positive')
    }
    const maxTail = options.diagnosticTailBytes ?? 4096
    let tail = Buffer.alloc(0),
      startupProgress = false,
      semanticProgress = false,
      lastSemantic = startedAt
    let reason: BrowserSessionResult['reason'] = 'exit',
      complete = false
    let killTimer: unknown
    const listeners: Array<() => void> = []
    const finish = (exit: BrowserSessionExit) => {
      if (complete) return
      complete = true
      deps.clearInterval(watchdog)
      deps.clearTimeout(deadlineTimer)
      if (killTimer) deps.clearTimeout(killTimer)
      for (const remove of listeners) remove()
      resolve({
        attempts: 0,
        deadlineExceeded: reason === 'deadline',
        diagnosticTail: tailText(tail, maxTail),
        exit,
        reason,
        semanticProgress,
        startupProgress,
      })
    }
    const signal = (value: NodeJS.Signals) => {
      try {
        deps.killProcessGroup(process.processGroupId, value)
      } catch {}
      try {
        process.kill(value)
      } catch {}
    }
    const terminate = (nextReason: BrowserSessionResult['reason']) => {
      if (reason !== 'exit') return
      reason = nextReason
      killTimer = deps.setTimeout(() => signal('SIGKILL'), options.graceMs)
      signal('SIGTERM')
    }
    const consume = () => {
      const decoder = new StringDecoder('utf8')
      let pending = ''
      const line = (value: string) => {
        const event = options.onLine(value)
        if (event === 'startup' && !startupProgress) {
          startupProgress = true
          lastSemantic = deps.now()
        }
        if (event === 'semantic') {
          semanticProgress = true
          lastSemantic = deps.now()
        }
      }
      return {
        flush: () => {
          const text = decoder.end()
          if (text) pending = boundPendingLine(pending + text)
          if (pending) line(pending)
        },
        write: (chunk: string | Buffer) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          tail = Buffer.concat([tail, bytes]).subarray(-maxTail)
          const split = splitCompleteLines(pending + decoder.write(bytes))
          pending = boundPendingLine(split.pending)
          for (const value of split.complete) line(value)
        },
      }
    }
    const streams = [process.stdout, process.stderr].map((stream) =>
      stream ? consume() : undefined,
    )
    for (const [index, stream] of [process.stdout, process.stderr].entries())
      stream?.on('data', streams[index]!.write)
    const watchdog = deps.setInterval(() => {
      const now = deps.now()
      if (now >= deadline) return terminate('deadline')
      if (!startupProgress && now - startedAt >= options.startupStallMs)
        return terminate('startup-stall')
      if (startupProgress && now - lastSemantic >= options.semanticStallMs)
        terminate('semantic-stall')
    }, options.watchdogIntervalMs ?? 1000)
    const deadlineTimer = deps.setTimeout(
      () => terminate('deadline'),
      Math.max(1, deadline - startedAt),
    )
    for (const value of ['SIGINT', 'SIGTERM'] as NodeJS.Signals[]) {
      const listener = () => terminate('parent-signal')
      deps.onParentSignal(value, listener)
      listeners.push(() => deps.offParentSignal(value, listener))
    }
    process.on('error', () => finish({ code: null, signal: null }))
    process.on('close', (code, value) => {
      for (const stream of streams) stream?.flush()
      if (reason === 'exit' && deps.now() >= deadline) reason = 'deadline'
      finish({ code, signal: value })
    })
  })
}
