import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  runBrowserSession,
  type BrowserSessionDeps,
  type BrowserSessionExit,
  type BrowserSessionProcess,
} from './index.mts'

class FakeProcess extends EventEmitter implements BrowserSessionProcess {
  processGroupId = 42
  readonly stderr = new EventEmitter()
  readonly stdout = new EventEmitter()
  readonly signals: NodeJS.Signals[] = []

  kill(signal?: NodeJS.Signals): boolean {
    if (signal) this.signals.push(signal)
    return true
  }
}

function makeClock() {
  let now = 0
  const intervals: Array<() => void> = []
  const timeouts: Array<{ at: number; callback: () => void }> = []
  const clearedIntervals: unknown[] = []
  const clearedTimeouts: unknown[] = []
  const parent = new EventEmitter()
  const processGroups: NodeJS.Signals[] = []
  const deps: BrowserSessionDeps = {
    clearInterval: (handle) => clearedIntervals.push(handle),
    clearTimeout: (handle) => clearedTimeouts.push(handle),
    killProcessGroup: (_pid, signal) => processGroups.push(signal),
    now: () => now,
    offParentSignal: (signal, listener) => parent.off(signal, listener),
    onParentSignal: (signal, listener) => parent.once(signal, listener),
    setInterval: (callback) => (intervals.push(callback), callback),
    setTimeout: (callback, ms) => {
      const timeout = { at: now + ms, callback }
      timeouts.push(timeout)
      return timeout
    },
  }
  return {
    deps,
    clearedIntervals,
    clearedTimeouts,
    emitSignal: (signal: NodeJS.Signals) => parent.emit(signal),
    parent,
    processGroups,
    tick: (ms: number) => {
      now += ms
      intervals.forEach((callback) => callback())
      for (const timeout of timeouts.filter((value) => value.at <= now)) timeout.callback()
    },
  }
}

function options(processes: FakeProcess[]) {
  return {
    attempts: 2,
    classifyExit: (exit: BrowserSessionExit) => (exit.code === 0 ? 'return' : 'retry'),
    deadlineMs: 100,
    graceMs: 10,
    onLine: (line: string) =>
      line.includes('ready') ? 'startup' : line.includes('test') ? 'semantic' : undefined,
    semanticStallMs: 20,
    start: () => processes.shift()!,
    startupStallMs: 20,
  }
}

describe('runBrowserSession', () => {
  it('buffers complete lines and returns diagnostic tails', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession({ ...options([child]), attempts: 1 }, clock.deps)
    child.stdout.emit('data', 'rea')
    child.stdout.emit('data', 'dy\ntest 1\n')
    child.stderr.emit('data', 'long-tail')
    child.emit('close', 0, null)
    await expect(run).resolves.toMatchObject({
      diagnosticTail: 'ready\ntest 1\nlong-tail',
      semanticProgress: true,
      startupProgress: true,
    })
  })

  it('does not combine partial lines from different streams', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession({ ...options([child]), attempts: 1 }, clock.deps)
    child.stdout.emit('data', 'rea')
    child.stderr.emit('data', 'dy\n')
    child.emit('close', 0, null)

    await expect(run).resolves.toMatchObject({ startupProgress: false })
  })

  it('terminates a startup stall with TERM followed by KILL', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession({ ...options([child]), attempts: 1 }, clock.deps)
    clock.tick(20)
    clock.tick(10)
    child.emit('close', null, 'SIGKILL')
    await expect(run).resolves.toMatchObject({ reason: 'startup-stall' })
    expect(clock.processGroups).toEqual(['SIGTERM', 'SIGKILL'])
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('terminates a semantic progress stall after startup completes', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession({ ...options([child]), attempts: 1 }, clock.deps)
    child.stdout.emit('data', 'ready\ntest 1\n')
    clock.tick(20)
    child.emit('close', null, 'SIGTERM')
    await expect(run).resolves.toMatchObject({ reason: 'semantic-stall' })
    expect(clock.processGroups).toEqual(['SIGTERM'])
  })

  it('terminates a semantic stall when startup completes without semantic progress', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession({ ...options([child]), attempts: 1 }, clock.deps)
    child.stdout.emit('data', 'ready\n')
    clock.tick(20)
    child.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({
      semanticProgress: false,
      reason: 'semantic-stall',
      startupProgress: true,
    })
  })

  it('retries a stall when the caller classifies its exit as retryable', async () => {
    const first = new FakeProcess()
    const second = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(options([first, second]), clock.deps)
    clock.tick(20)
    first.emit('close', null, 'SIGTERM')
    await Promise.resolve()
    second.emit('close', 0, null)

    await expect(run).resolves.toMatchObject({ attempts: 2, exit: { code: 0 } })
  })

  it('does not let repeated startup lines delay the semantic watchdog', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession({ ...options([child]), attempts: 1 }, clock.deps)
    child.stdout.emit('data', 'ready\n')
    clock.tick(10)
    child.stdout.emit('data', 'ready\n')
    clock.tick(10)
    child.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ reason: 'semantic-stall' })
  })

  it('shares one deadline across retryable attempts', async () => {
    const first = new FakeProcess()
    const second = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(options([first, second]), clock.deps)
    first.emit('close', 1, null)
    await Promise.resolve()
    clock.tick(100)
    second.emit('close', null, 'SIGTERM')
    await expect(run).resolves.toMatchObject({
      attempts: 2,
      deadlineExceeded: true,
      reason: 'deadline',
    })
  })

  it('returns the terminal nonzero exit without retrying when the classifier says so', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession({ ...options([child]), classifyExit: () => 'return' }, clock.deps)
    child.emit('close', 2, null)

    await expect(run).resolves.toMatchObject({ attempts: 1, exit: { code: 2, signal: null } })
  })

  it('returns the final retryable exit after exhausting attempts', async () => {
    const first = new FakeProcess()
    const second = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(options([first, second]), clock.deps)
    first.emit('close', 1, null)
    await Promise.resolve()
    second.emit('close', 1, null)

    await expect(run).resolves.toMatchObject({ attempts: 2, reason: 'exit', exit: { code: 1 } })
  })

  it('returns an expired result when the shared deadline prevents the first attempt', async () => {
    const clock = makeClock()
    let calls = 0
    const deps = { ...clock.deps, now: () => (calls++ === 0 ? 0 : 100) }

    await expect(runBrowserSession(options([]), deps)).resolves.toMatchObject({
      attempts: 0,
      deadlineExceeded: true,
      reason: 'deadline',
    })
  })

  it('distinguishes the deadline watchdog from a startup stall', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(
      { ...options([child]), attempts: 1, deadlineMs: 30, startupStallMs: 10_000 },
      clock.deps,
    )
    clock.tick(30)
    child.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ deadlineExceeded: true, reason: 'deadline' })
  })

  it('enforces the shared deadline without waiting for a slow watchdog', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(
      { ...options([child]), attempts: 1, watchdogIntervalMs: 1_000 },
      clock.deps,
    )
    clock.tick(100)
    child.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ deadlineExceeded: true, reason: 'deadline' })
  })

  it('terminates the process group when the parent receives a signal', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(options([child]), clock.deps)
    clock.emitSignal('SIGTERM')
    clock.emitSignal('SIGINT')
    child.emit('close', null, 'SIGTERM')
    await expect(run).resolves.toMatchObject({ reason: 'parent-signal' })
    expect(clock.processGroups).toEqual(['SIGTERM'])
  })

  it('uses the default process-group and parent-signal hooks', async () => {
    const child = new FakeProcess()
    child.kill = (signal?: NodeJS.Signals) => {
      if (signal) child.signals.push(signal)
      child.emit('close', null, signal ?? null)
      return true
    }
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const run = runBrowserSession({ ...options([child]), attempts: 1 })

    process.emit('SIGTERM')

    await expect(run).resolves.toMatchObject({ reason: 'parent-signal' })
    expect(kill).toHaveBeenCalledWith(-child.processGroupId, 'SIGTERM')
    kill.mockRestore()
  })

  it('ignores a vanished default process group during termination', async () => {
    const child = new FakeProcess()
    const error = Object.assign(new Error('gone'), { code: 'ESRCH' })
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw error
    })
    const run = runBrowserSession({ ...options([child]), attempts: 1 })
    process.emit('SIGTERM')
    child.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ reason: 'parent-signal' })
    kill.mockRestore()
  })

  it('cleans up timers and parent listeners after a close', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(options([child]), clock.deps)
    clock.tick(1)
    child.emit('close', 0, null)
    child.emit('close', 1, null)
    await run

    expect(clock.clearedIntervals).toHaveLength(1)
    expect(clock.clearedTimeouts).toHaveLength(1)
    expect(clock.parent.listenerCount('SIGINT')).toBe(0)
    expect(clock.parent.listenerCount('SIGTERM')).toBe(0)
  })

  it('supports processes with no output streams while retaining group lifecycle control', async () => {
    const child = new FakeProcess()
    Reflect.deleteProperty(child, 'stdout')
    Reflect.deleteProperty(child, 'stderr')
    const clock = makeClock()
    const run = runBrowserSession(options([child]), clock.deps)
    clock.emitSignal('SIGINT')
    child.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ diagnosticTail: '', reason: 'parent-signal' })
    expect(clock.processGroups).toEqual(['SIGTERM'])
  })

  it('decodes split UTF-8 and flushes each stream pending line on close', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(
      {
        ...options([child]),
        attempts: 1,
        onLine: (line) => (line.includes('✅ ready') ? 'startup' : undefined),
      },
      clock.deps,
    )
    const bytes = Buffer.from('✅ ready')
    child.stdout.emit('data', bytes.subarray(0, 2))
    child.stdout.emit('data', bytes.subarray(2))
    child.stderr.emit('data', 'stderr final')
    child.emit('close', 0, null)

    await expect(run).resolves.toMatchObject({
      diagnosticTail: '✅ readystderr final',
      startupProgress: true,
    })
  })

  it('returns a UTF-8-safe diagnostic tail within its byte budget', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(
      { ...options([child]), attempts: 1, diagnosticTailBytes: 5 },
      clock.deps,
    )
    child.stdout.emit('data', 'a😀b')
    child.emit('close', 0, null)

    const result = await run
    expect(result.diagnosticTail).toBe('😀b')
    expect(Buffer.byteLength(result.diagnosticTail)).toBeLessThanOrEqual(5)
  })

  it('returns an error-event exit instead of leaving an unhandled child error', async () => {
    const child = new FakeProcess()
    const run = runBrowserSession({ ...options([child]), attempts: 1 }, makeClock().deps)
    child.emit('error', new Error('spawn failed'))

    await expect(run).resolves.toMatchObject({ exit: { code: null, signal: null } })
  })

  it('continues direct-child cleanup when process-group signalling throws', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(
      { ...options([child]), attempts: 1 },
      {
        ...clock.deps,
        killProcessGroup: () => {
          throw new Error('group failed')
        },
      },
    )
    clock.emitSignal('SIGTERM')
    child.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ reason: 'parent-signal' })
    expect(child.signals).toEqual(['SIGTERM'])
  })

  it('rejects a process whose process group cannot be signalled independently', async () => {
    const child = new FakeProcess()
    child.processGroupId = 0

    await expect(runBrowserSession(options([child]), makeClock().deps)).rejects.toThrow(
      'processGroupId',
    )
    expect(child.signals).toEqual(['SIGKILL'])
  })

  it('rejects invalid lifecycle budgets before starting a process', async () => {
    for (const [property, value] of [
      ['attempts', 0],
      ['deadlineMs', Number.POSITIVE_INFINITY],
      ['graceMs', -1],
      ['semanticStallMs', 1.5],
      ['startupStallMs', 0],
      ['watchdogIntervalMs', 0],
      ['diagnosticTailBytes', 0],
    ] as const) {
      await expect(
        runBrowserSession({ ...options([]), [property]: value }, makeClock().deps),
      ).rejects.toThrow(property)
    }
  })
})
