import { createOutputConsumer } from './output.mts'
import { tailText } from './tail.mts'
import { TailQueue } from './tail-queue.mts'
import { terminateAttempt, type AttemptControl } from './termination.mts'
import { createWatchdogLifecycle, registerWatchdogSetup } from './watchdog.mts'
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
    const drainTimeoutMs = options.graceMs + (options.processGroupDrainMs ?? options.graceMs)
    const tail = new TailQueue(maxTail)
    let startupProgress = false,
      semanticProgress = false
    let failure: unknown,
      hasFailure = false,
      closeExit: BrowserSessionExit | undefined,
      draining = false,
      drainDone = false,
      complete = false
    let stallTimer: unknown
    const control: AttemptControl = {
      childExited: false,
      deps,
      graceMs: options.graceMs,
      killTimer: undefined,
      process,
      reason: 'exit',
      terminating: false,
    }
    const watchdog = createWatchdogLifecycle()
    const listeners: Array<() => void> = []
    const captureFailure = (error: unknown) =>
      !hasFailure && ((failure = error), (hasFailure = true))
    const finish = (exit: BrowserSessionExit) => {
      if (complete) return
      complete = true
      deps.clearTimeout(deadlineTimer)
      if (control.killTimer) deps.clearTimeout(control.killTimer)
      deps.clearTimeout(stallTimer)
      watchdog.complete(captureFailure)
      for (const remove of listeners) remove()
      const result = {
        attempts: 0,
        deadlineExceeded: control.reason === 'deadline',
        diagnosticTail: tailText(tail.toBuffer(), maxTail),
        exit,
        reason: control.reason,
        semanticProgress,
        startupProgress,
      }
      if (hasFailure) reject(failure)
      else resolve(result)
    }
    const terminate = (nextReason: BrowserSessionResult['reason']) => {
      terminateAttempt(control, nextReason)
    }
    const fail = (error: unknown) => {
      if (hasFailure || complete) return
      captureFailure(error)
      terminate('exit')
    }
    const drain = () => {
      if (draining) return
      draining = true
      void deps.waitForProcessGroupExit(process.processGroupId, drainTimeoutMs).then(
        () => {
          drainDone = true
          if (closeExit) finish(closeExit)
        },
        (error) => {
          fail(error)
          finish(closeExit ?? { code: null, signal: null })
        },
      )
    }
    const armStall = (ms: number, nextReason: 'semantic-stall' | 'startup-stall') => {
      if (stallTimer) deps.clearTimeout(stallTimer)
      stallTimer = deps.setTimeout(() => terminate(nextReason), ms)
    }
    const line = (value: string) => {
      const event = options.onLine(value)
      if (event === 'startup' && !startupProgress) {
        startupProgress = true
        if (!control.childExited) armStall(options.semanticStallMs, 'semantic-stall')
      }
      if (event === 'semantic') {
        semanticProgress = true
        if (startupProgress && !control.childExited)
          armStall(options.semanticStallMs, 'semantic-stall')
      }
    }
    const streams = [process.stdout, process.stderr].map((stream, index) =>
      stream
        ? createOutputConsumer(options, tail, index === 0 ? 'stdout' : 'stderr', line)
        : undefined,
    )
    for (const [index, stream] of [process.stdout, process.stderr].entries())
      stream?.on('data', (chunk) => {
        try {
          streams[index]!.write(chunk)
        } catch (error) {
          fail(error)
        }
      })
    for (const stream of [process.stdout, process.stderr]) stream?.on('error', fail)
    const remainingDeadlineMs = deadline - deps.now()
    const deadlineTimer = deps.setTimeout(
      () => terminate('deadline'),
      Math.max(1, remainingDeadlineMs),
    )
    const remainingStartupMs = options.startupStallMs - (deps.now() - startedAt)
    armStall(Math.max(1, remainingStartupMs), 'startup-stall')
    if (remainingStartupMs <= 0) terminate('startup-stall')
    if (remainingDeadlineMs <= 0) terminate('deadline')
    for (const value of ['SIGINT', 'SIGTERM'] as NodeJS.Signals[]) {
      const listener = () => terminate('parent-signal')
      deps.onParentSignal(value, listener)
      listeners.push(() => deps.offParentSignal(value, listener))
    }
    process.on('error', () => terminate('exit'))
    process.on('exit', () => {
      if (control.reason === 'exit' && deps.now() >= deadline) control.reason = 'deadline'
      control.childExited = true
      deps.clearTimeout(stallTimer)
      if (!deps.isProcessGroupAlive(process.processGroupId)) return
      terminate(control.reason)
      drain()
    })
    process.on('close', (code, value) => {
      for (const stream of streams)
        try {
          stream?.flush()
        } catch (error) {
          fail(error)
        }
      if (
        !control.childExited &&
        deps.now() >= deadline &&
        control.reason !== 'parent-signal' &&
        control.reason !== 'deadline'
      )
        control.reason = 'deadline'
      closeExit = { code, signal: value }
      if (!deps.isProcessGroupAlive(process.processGroupId)) return finish(closeExit)
      terminate(control.reason)
      drain()
      if (drainDone || hasFailure) finish(closeExit)
    })
    try {
      const setup = options.watchdog?.({
        attempt,
        deadline,
        now: () => deps.now(),
        process,
        terminate: () => {
          if (!control.childExited) terminate('provider-watchdog')
        },
      })
      registerWatchdogSetup(setup, watchdog, fail)
    } catch (error) {
      fail(error)
    }
  })
}
