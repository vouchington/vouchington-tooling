import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import {
  runBrowserSession,
  type BrowserSessionDeps,
  type BrowserSessionProcess,
  type BrowserSessionResult,
} from './index.mts'

class Process extends EventEmitter implements BrowserSessionProcess {
  processGroupId = 42
  readonly stderr = new EventEmitter()
  readonly stdout = new EventEmitter()
  readonly signals: NodeJS.Signals[] = []

  kill(signal?: NodeJS.Signals): boolean {
    if (signal) this.signals.push(signal)
    return true
  }
}

function clock() {
  let now = 0
  const parent = new EventEmitter()
  const timeouts: Array<{ at: number; callback: () => void }> = []
  const deps: BrowserSessionDeps = {
    clearInterval: () => {},
    clearTimeout: () => {},
    isProcessGroupAlive: () => false,
    killProcessGroup: () => {},
    now: () => now,
    offParentSignal: (signal, listener) => parent.off(signal, listener),
    onParentSignal: (signal, listener) => parent.once(signal, listener),
    setInterval: () => undefined,
    setTimeout: (callback, ms) => (timeouts.push({ at: now + ms, callback }), callback),
    waitForProcessGroupExit: async () => {},
  }
  return {
    advance(ms: number) {
      now += ms
      for (const timeout of timeouts.filter((value) => value.at <= now)) timeout.callback()
    },
    deps,
    signal(signal: NodeJS.Signals) {
      parent.emit(signal)
    },
  }
}

function options(process: Process) {
  return {
    attempts: 1,
    classifyExit: () => 'return' as const,
    deadlineMs: 100,
    graceMs: 10,
    onLine: () => undefined,
    semanticStallMs: 20,
    start: () => process,
    startupStallMs: 20,
  }
}

describe('browser-session-runner extension hooks', () => {
  it('passes each unmodified output chunk with its source before line decoding', async () => {
    const process = new Process(),
      testClock = clock()
    const chunks: Array<{ chunk: string | Buffer; source: string }> = []
    const run = runBrowserSession(
      { ...options(process), onOutput: (output) => chunks.push(output) },
      testClock.deps,
    )
    const stderr = Buffer.from('stderr')
    process.stdout.emit('data', 'stdout')
    process.stderr.emit('data', stderr)
    process.emit('close', 0, null)

    await run
    expect(chunks).toEqual([
      { chunk: 'stdout', source: 'stdout' },
      { chunk: stderr, source: 'stderr' },
    ])
    expect(chunks[1]!.chunk).toBe(stderr)
  })

  it('lets a provider watchdog terminate an attempt and runs its cleanup once', async () => {
    const process = new Process(),
      testClock = clock()
    let cleanup = 0
    const run = runBrowserSession(
      {
        ...options(process),
        watchdog: (controller) => {
          expect(controller.attempt).toBe(1)
          expect(controller.deadline).toBe(100)
          expect(controller.now()).toBe(0)
          expect(controller.process).toBe(process)
          controller.terminate()
          return () => {
            cleanup += 1
          }
        },
      },
      testClock.deps,
    )
    expect(process.signals).toEqual(['SIGTERM'])
    process.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ reason: 'provider-watchdog' })
    expect(cleanup).toBe(1)
  })

  it('rejects when provider watchdog setup or cleanup fails', async () => {
    const setupProcess = new Process(),
      setupClock = clock()
    const setup = runBrowserSession(
      {
        ...options(setupProcess),
        watchdog: () => {
          throw new Error('watchdog setup failed')
        },
      },
      setupClock.deps,
    )
    setupProcess.emit('close', null, 'SIGTERM')
    await expect(setup).rejects.toThrow('watchdog setup failed')

    const cleanupProcess = new Process(),
      cleanupClock = clock()
    const cleanup = runBrowserSession(
      {
        ...options(cleanupProcess),
        watchdog: () => () => {
          throw new Error('watchdog cleanup failed')
        },
      },
      cleanupClock.deps,
    )
    cleanupProcess.emit('close', 0, null)
    await expect(cleanup).rejects.toThrow('watchdog cleanup failed')
  })

  it.each(['SIGINT', 'SIGTERM'] as NodeJS.Signals[])(
    'reports a parent %s outcome to each attempt completion callback',
    async (signal) => {
      const process = new Process(),
        testClock = clock()
      const completed: BrowserSessionResult[] = []
      const run = runBrowserSession(
        { ...options(process), onAttemptComplete: (result) => completed.push(result) },
        testClock.deps,
      )
      testClock.signal(signal)
      process.emit('close', null, signal)

      await expect(run).resolves.toMatchObject({ reason: 'parent-signal' })
      expect(completed).toEqual([
        expect.objectContaining({ attempts: 1, deadlineExceeded: false, reason: 'parent-signal' }),
      ])
    },
  )

  it('reports a deadline outcome to the attempt completion callback', async () => {
    const process = new Process(),
      testClock = clock()
    const completed: BrowserSessionResult[] = []
    const run = runBrowserSession(
      { ...options(process), onAttemptComplete: (result) => completed.push(result) },
      testClock.deps,
    )
    testClock.advance(100)
    process.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ deadlineExceeded: true, reason: 'deadline' })
    expect(completed).toEqual([
      expect.objectContaining({ attempts: 1, deadlineExceeded: true, reason: 'deadline' }),
    ])
  })

  it('reports every retryable attempt before returning the next outcome', async () => {
    const first = new Process(),
      second = new Process(),
      testClock = clock()
    const completed: BrowserSessionResult[] = []
    const run = runBrowserSession(
      {
        ...options(first),
        attempts: 2,
        classifyExit: (exit) => (exit.code === 0 ? 'return' : 'retry'),
        onAttemptComplete: (result) => completed.push(result),
        start: (attempt) => (attempt === 1 ? first : second),
      },
      testClock.deps,
    )
    first.emit('close', 1, null)
    await Promise.resolve()
    second.emit('close', 0, null)

    await expect(run).resolves.toMatchObject({ attempts: 2, exit: { code: 0 } })
    expect(completed.map((result) => result.attempts)).toEqual([1, 2])
  })

  it('preserves a primary failure when watchdog cleanup also throws', async () => {
    const process = new Process(),
      testClock = clock()
    const primary = new Error('output failed')
    const cleanup = new Error('cleanup failed')
    const run = runBrowserSession(
      {
        ...options(process),
        onOutput: () => {
          throw primary
        },
        watchdog: () => () => {
          throw cleanup
        },
      },
      testClock.deps,
    )
    process.stdout.emit('data', 'output')
    process.emit('close', null, 'SIGTERM')

    await expect(run).rejects.toBe(primary)
  })

  it('cleans up an asynchronous watchdog setup that resolves after completion', async () => {
    const process = new Process(),
      testClock = clock()
    let resolve: (cleanup: () => void) => void = () => {}
    let cleanups = 0
    const setup = new Promise<() => void>((complete) => {
      resolve = complete
    })
    const run = runBrowserSession({ ...options(process), watchdog: () => setup }, testClock.deps)
    process.emit('close', 0, null)
    await run
    resolve(() => {
      cleanups += 1
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(cleanups).toBe(1)
  })

  it('rejects when asynchronous watchdog setup fails before completion', async () => {
    const process = new Process(),
      testClock = clock()
    let reject: (error: Error) => void = () => {}
    const setup = new Promise<void>((_resolve, fail) => {
      reject = fail
    })
    const run = runBrowserSession({ ...options(process), watchdog: () => setup }, testClock.deps)
    reject(new Error('async watchdog setup failed'))
    await Promise.resolve()
    expect(process.signals).toEqual(['SIGTERM'])
    process.emit('close', null, 'SIGTERM')

    await expect(run).rejects.toThrow('async watchdog setup failed')
  })

  it('ignores asynchronous watchdog setup failure after completion', async () => {
    const process = new Process(),
      testClock = clock()
    let reject: (error: Error) => void = () => {}
    const setup = new Promise<void>((_resolve, fail) => {
      reject = fail
    })
    const run = runBrowserSession({ ...options(process), watchdog: () => setup }, testClock.deps)
    process.emit('close', 0, null)
    await run
    reject(new Error('late async watchdog setup failure'))
    await Promise.resolve()
    await Promise.resolve()
  })

  it('does not let a watchdog reclassify an exited child', async () => {
    const process = new Process(),
      testClock = clock()
    let terminate: (() => void) | undefined
    const run = runBrowserSession(
      {
        ...options(process),
        watchdog: (controller) => {
          terminate = () => controller.terminate()
        },
      },
      testClock.deps,
    )
    process.emit('exit', 0, null)
    terminate!()
    process.emit('close', 0, null)

    await expect(run).resolves.toMatchObject({ reason: 'exit' })
    expect(process.signals).toEqual([])
  })

  it('isolates completion-observer mutations from retry classification and results', async () => {
    const first = new Process(),
      second = new Process(),
      testClock = clock()
    const run = runBrowserSession(
      {
        ...options(first),
        attempts: 2,
        classifyExit: (exit) => (exit.code === 0 ? 'return' : 'retry'),
        onAttemptComplete: (result) => {
          result.attempts = 99
          result.exit.code = 0
          result.reason = 'parent-signal'
        },
        start: (attempt) => (attempt === 1 ? first : second),
      },
      testClock.deps,
    )
    first.emit('close', 1, null)
    await Promise.resolve()
    second.emit('close', 0, null)

    await expect(run).resolves.toMatchObject({ attempts: 2, exit: { code: 0 }, reason: 'exit' })
  })
})
