import { StringDecoder } from 'node:string_decoder'

import { boundPendingLine, splitCompleteLines } from '../process-line-buffer/index.mts'
import { tailText } from './tail.mts'
import { TailQueue } from './tail-queue.mts'
import type {
  BrowserSessionDeps,
  BrowserSessionExit,
  BrowserSessionOptions,
  BrowserSessionResult,
} from './types.mts'

export function runAttempt(
  options: BrowserSessionOptions,
  deps: BrowserSessionDeps,
  deadline: number,
  attempt: number,
) {
  return new Promise<BrowserSessionResult>((resolve, reject) => {
    const startedAt = deps.now(),
      process = options.start(attempt)
    if (
      !Number.isSafeInteger(process.processGroupId) ||
      process.processGroupId <= 0 ||
      process.processGroupId > 2_147_483_647
    ) {
      try {
        process.kill('SIGKILL')
      } catch {}
      throw new RangeError('processGroupId must be positive')
    }
    const maxTail = options.diagnosticTailBytes ?? 4096
    const tail = new TailQueue(maxTail)
    let startupProgress = false,
      semanticProgress = false,
      lastSemantic = startedAt
    let failure: unknown,
      hasFailure = false,
      childExited = false,
      closeExit: BrowserSessionExit | undefined,
      killSent = false,
      draining = false,
      reason: BrowserSessionResult['reason'] = 'exit',
      complete = false,
      terminating = false
    let killTimer: unknown
    const listeners: Array<() => void> = []
    const finish = (exit: BrowserSessionExit) => {
      if (complete) return
      complete = true
      deps.clearInterval(watchdog)
      deps.clearTimeout(deadlineTimer)
      if (killTimer) deps.clearTimeout(killTimer)
      for (const remove of listeners) remove()
      const result = {
        attempts: 0,
        deadlineExceeded: reason === 'deadline',
        diagnosticTail: tailText(tail.toBuffer(), maxTail),
        exit,
        reason,
        semanticProgress,
        startupProgress,
      }
      if (hasFailure) reject(failure)
      else resolve(result)
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
      if (nextReason === 'deadline' && childExited && reason === 'exit') return
      if (nextReason === 'parent-signal' || nextReason === 'deadline') {
        if (reason === 'exit' || reason === 'startup-stall' || reason === 'semantic-stall')
          reason = nextReason
        else if (reason !== nextReason) return
      } else if (reason !== 'exit') return
      else if (nextReason !== 'exit') reason = nextReason
      if (terminating) return
      terminating = true
      killTimer = deps.setTimeout(() => {
        killSent = true
        signal('SIGKILL')
        drain()
      }, options.graceMs)
      signal('SIGTERM')
    }
    const fail = (error: unknown) => {
      if (hasFailure) return
      failure = error
      hasFailure = true
      terminate('exit')
    }
    const drain = () => {
      if (!closeExit || !killSent || draining) return
      draining = true
      void deps
        .waitForProcessGroupExit(
          process.processGroupId,
          options.processGroupDrainMs ?? options.graceMs,
        )
        .then(
          () => finish(closeExit!),
          (error) => {
            fail(error)
            finish(closeExit!)
          },
        )
    }
    const consume = () => {
      const decoder = new StringDecoder('utf8')
      let pending = ''
      const append = (text: string) => tail.append(text)
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
      const appendLines = (text: string) => {
        append(text)
        const split = splitCompleteLines(pending + text)
        pending = boundPendingLine(split.pending)
        for (const value of split.complete) line(value)
      }
      return {
        flush: () => {
          appendLines(decoder.end())
          if (pending) line(pending)
        },
        write: (chunk: string | Buffer) =>
          appendLines(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))),
      }
    }
    const streams = [process.stdout, process.stderr].map((stream) =>
      stream ? consume() : undefined,
    )
    for (const [index, stream] of [process.stdout, process.stderr].entries())
      stream?.on('data', (chunk) => {
        try {
          streams[index]!.write(chunk)
        } catch (error) {
          fail(error)
        }
      })
    const watchdog = deps.setInterval(() => {
      const now = deps.now()
      if (now >= deadline) return terminate('deadline')
      if (!startupProgress && now - startedAt >= options.startupStallMs)
        return terminate('startup-stall')
      if (startupProgress && now - lastSemantic >= options.semanticStallMs)
        terminate('semantic-stall')
    }, options.watchdogIntervalMs ?? 1000)
    const remainingDeadlineMs = deadline - deps.now()
    const deadlineTimer = deps.setTimeout(
      () => terminate('deadline'),
      Math.max(1, remainingDeadlineMs),
    )
    if (remainingDeadlineMs <= 0) terminate('deadline')
    for (const value of ['SIGINT', 'SIGTERM'] as NodeJS.Signals[]) {
      const listener = () => terminate('parent-signal')
      deps.onParentSignal(value, listener)
      listeners.push(() => deps.offParentSignal(value, listener))
    }
    process.on('error', () => terminate('exit'))
    process.on('exit', () => {
      if (reason === 'exit' && deps.now() >= deadline) reason = 'deadline'
      childExited = true
      if (deps.isProcessGroupAlive(process.processGroupId)) terminate(reason)
    })
    process.on('close', (code, value) => {
      for (const stream of streams)
        try {
          stream?.flush()
        } catch (error) {
          fail(error)
        }
      if (!childExited && reason === 'exit' && deps.now() >= deadline) reason = 'deadline'
      closeExit = { code, signal: value }
      if (!deps.isProcessGroupAlive(process.processGroupId)) return finish(closeExit)
      terminate(reason)
      drain()
    })
  })
}
