import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { runBrowserSession, type BrowserSessionDeps, type BrowserSessionProcess } from './index.mts'

class Process extends EventEmitter implements BrowserSessionProcess {
  processGroupId = 1
  readonly stderr = new EventEmitter()
  readonly stdout = new EventEmitter()
  readonly signals: NodeJS.Signals[] = []

  kill(signal?: NodeJS.Signals): boolean {
    if (signal) this.signals.push(signal)
    return true
  }
}

function harness(alive = false) {
  let now = 0
  let watchdog = () => {}
  let grace = () => {}
  const timeouts: Array<{ at: number; callback: () => void }> = []
  const cancelled = new Set<unknown>()
  const parent = new EventEmitter()
  let release: () => void = () => {}
  const exited = new Promise<void>((resolve) => {
    release = resolve
  })
  const runDue = () => {
    const due = timeouts.filter((value) => value.at <= now && !cancelled.has(value))
    timeouts.splice(0, timeouts.length, ...timeouts.filter((value) => value.at > now))
    for (const timeout of due) timeout.callback()
  }
  const deps: BrowserSessionDeps = {
    clearInterval: () => {},
    clearTimeout: (handle) => cancelled.add(handle),
    isProcessGroupAlive: () => alive,
    killProcessGroup: () => {},
    now: () => now,
    offParentSignal: (signal, listener) => parent.off(signal, listener),
    onParentSignal: (signal, listener) => parent.once(signal, listener),
    setInterval: (callback) => ((watchdog = callback), callback),
    setTimeout: (callback, ms) => {
      const timeout = {
        at: now + ms,
        callback: () => {
          callback()
          if (ms === 10) grace = () => {}
        },
      }
      if (ms === 10) grace = timeout.callback
      timeouts.push(timeout)
      return timeout
    },
    waitForProcessGroupExit: () => exited,
  }
  return {
    advance: (ms: number) => {
      now += ms
    },
    deps,
    emitParent: () => parent.emit('SIGTERM'),
    release: () => release(),
    elapse: (ms: number) => {
      now += ms
      runDue()
    },
    tick: (ms: number) => {
      now += ms
      watchdog()
      runDue()
    },
    triggerGrace: () => grace(),
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

describe('browser-session-runner review regressions', () => {
  it('lets a parent signal supersede a stall without duplicate termination', async () => {
    const process = new Process(),
      clock = harness()
    const run = runBrowserSession(options(process), clock.deps)
    clock.tick(20)
    clock.emitParent()
    process.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ reason: 'parent-signal' })
    expect(process.signals).toEqual(['SIGTERM'])
  })

  it('lets a deadline supersede a stall without duplicate termination', async () => {
    const process = new Process(),
      clock = harness()
    const run = runBrowserSession(options(process), clock.deps)
    clock.tick(20)
    clock.tick(80)
    process.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ reason: 'deadline' })
    expect(process.signals).toEqual(['SIGTERM'])
  })

  it('promotes a stalled close that arrives after an overdue deadline', async () => {
    const process = new Process(),
      clock = harness()
    const run = runBrowserSession(options(process), clock.deps)
    clock.elapse(20)
    clock.advance(80)
    process.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ deadlineExceeded: true, reason: 'deadline' })
  })

  it('enforces startup stalls without waiting for a slow watchdog tick', async () => {
    const process = new Process(),
      clock = harness()
    const run = runBrowserSession({ ...options(process), watchdogIntervalMs: 1_000 }, clock.deps)
    clock.elapse(20)
    expect(process.signals).toEqual(['SIGTERM'])
    process.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ reason: 'startup-stall' })
  })

  it('resets the direct semantic stall timer after progress', async () => {
    const process = new Process(),
      clock = harness()
    const run = runBrowserSession(
      {
        ...options(process),
        watchdogIntervalMs: 1_000,
        onLine: (line) => (line.startsWith('ready') ? 'startup' : 'semantic'),
      },
      clock.deps,
    )
    process.stdout.emit('data', 'ready\n')
    clock.elapse(10)
    process.stdout.emit('data', 'progress\n')
    clock.elapse(19)
    expect(process.signals).toEqual([])
    clock.elapse(1)
    expect(process.signals).toEqual(['SIGTERM'])
    process.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ reason: 'semantic-stall' })
  })

  it('keeps the first terminal reason when a different terminal event follows', async () => {
    const process = new Process(),
      clock = harness()
    const run = runBrowserSession(options(process), clock.deps)
    clock.emitParent()
    clock.tick(100)
    process.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ reason: 'parent-signal' })
    expect(process.signals).toEqual(['SIGTERM'])
  })

  it('aggregates decoded stream output without corrupting interleaved UTF-8', async () => {
    const process = new Process(),
      clock = harness()
    const run = runBrowserSession(options(process), clock.deps)
    const first = Buffer.from('✅'),
      second = Buffer.from('😀')
    process.stdout.emit('data', first.subarray(0, 2))
    process.stderr.emit('data', second.subarray(0, 2))
    process.stdout.emit('data', first.subarray(2))
    process.stderr.emit('data', second.subarray(2))
    process.emit('close', 0, null)

    await expect(run).resolves.toMatchObject({ diagnosticTail: '✅😀' })
  })

  it('drains descendants after a child close before completing the attempt', async () => {
    const process = new Process(),
      clock = harness(true)
    const run = runBrowserSession(options(process), clock.deps)
    let settled = false
    void run.then(() => {
      settled = true
    })
    process.emit('close', 0, null)
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(process.signals).toEqual(['SIGTERM'])
    clock.release()

    await expect(run).resolves.toMatchObject({ exit: { code: 0 } })
    expect(process.signals).toEqual(['SIGTERM'])
  })

  it('starts only one group drain while a close is being finalized', async () => {
    const process = new Process(),
      clock = harness(true)
    let calls = 0
    let release: () => void = () => {}
    const drained = new Promise<void>((resolve) => {
      release = resolve
    })
    clock.deps.waitForProcessGroupExit = () => {
      calls += 1
      return drained
    }
    const run = runBrowserSession(options(process), clock.deps)
    process.emit('close', 0, null)
    process.emit('close', 0, null)
    expect(calls).toBe(1)
    release()

    await expect(run).resolves.toMatchObject({ exit: { code: 0 } })
  })

  it('starts group cleanup at child exit before inherited output streams close', async () => {
    const process = new Process(),
      clock = harness(true)
    const run = runBrowserSession(
      { ...options(process), semanticStallMs: 10_000, startupStallMs: 10_000 },
      clock.deps,
    )
    process.emit('exit', 1, null)
    expect(process.signals).toEqual(['SIGTERM'])
    clock.tick(100)
    expect(process.signals).toEqual(['SIGTERM', 'SIGKILL'])

    process.emit('close', 1, null)
    await Promise.resolve()
    clock.triggerGrace()
    clock.release()

    await expect(run).resolves.toMatchObject({ deadlineExceeded: false, reason: 'exit' })
  })

  it('keeps exit-triggered drain bounds active while inherited output delays close', async () => {
    const process = new Process(),
      clock = harness(true)
    const run = runBrowserSession(options(process), clock.deps)
    process.emit('exit', 0, null)
    clock.release()
    await Promise.resolve()
    process.emit('close', 0, null)

    await expect(run).resolves.toMatchObject({ reason: 'exit' })
  })

  it('does not rearm stalls or finish a drain failure before close flushes', async () => {
    const process = new Process(),
      clock = harness(true)
    const failure = new Error('drain failed')
    clock.deps.waitForProcessGroupExit = async () => {
      throw failure
    }
    const outcome = runBrowserSession(
      { ...options(process), onLine: () => 'startup' },
      clock.deps,
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    process.emit('exit', 0, null)
    process.stdout.emit('data', 'late startup\n')
    await Promise.resolve()
    process.emit('close', 0, null)

    await expect(outcome).resolves.toBe(failure)
  })

  it('rejects default process-group control on Windows before starting a child', async () => {
    const process = new Process()
    let started = false
    const platform = vi.spyOn(globalThis.process, 'platform', 'get').mockReturnValue('win32')
    await expect(
      runBrowserSession({
        ...options(process),
        start: () => {
          started = true
          return process
        },
      }),
    ).rejects.toThrow('unsupported on Windows')
    expect(started).toBe(false)
    platform.mockRestore()
  })

  it('stops stall supervision after child exit while allowing a parent signal to supersede', async () => {
    const process = new Process(),
      clock = harness(true)
    const run = runBrowserSession(options(process), clock.deps)
    process.emit('exit', 0, null)
    clock.elapse(20)
    clock.emitParent()
    process.emit('close', 0, null)
    clock.release()

    await expect(run).resolves.toMatchObject({ reason: 'parent-signal' })
  })

  it('keeps startup supervision active for semantic output before startup', async () => {
    const process = new Process(),
      clock = harness()
    const run = runBrowserSession(
      { ...options(process), onLine: () => 'semantic', watchdogIntervalMs: 1_000 },
      clock.deps,
    )
    process.stdout.emit('data', 'output\n')
    process.stderr.emit('data', 'more output\n')
    clock.elapse(20)
    process.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({
      reason: 'startup-stall',
      semanticProgress: true,
      startupProgress: false,
    })
  })

  it('counts synchronous process creation against the startup budget', async () => {
    const process = new Process(),
      clock = harness()
    const run = runBrowserSession(
      {
        ...options(process),
        watchdogIntervalMs: 1_000,
        start: () => {
          clock.advance(20)
          return process
        },
      },
      clock.deps,
    )
    expect(process.signals).toEqual(['SIGTERM'])
    process.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ reason: 'startup-stall' })
  })

  it('does not signal a group that has already exited with its direct child', async () => {
    const process = new Process(),
      clock = harness()
    const run = runBrowserSession(options(process), clock.deps)
    process.emit('exit', 0, null)
    expect(process.signals).toEqual([])
    process.emit('close', 0, null)

    await expect(run).resolves.toMatchObject({ exit: { code: 0 }, reason: 'exit' })
  })

  it('classifies a child exit after an overdue deadline before its timer runs', async () => {
    const process = new Process(),
      clock = harness(true)
    const run = runBrowserSession(options(process), clock.deps)
    clock.advance(100)
    process.emit('exit', 1, null)
    expect(process.signals).toEqual(['SIGTERM'])
    process.emit('close', 1, null)
    await Promise.resolve()
    clock.triggerGrace()
    clock.release()

    await expect(run).resolves.toMatchObject({ deadlineExceeded: true, reason: 'deadline' })
  })

  it('rejects after a bounded descendant drain cannot clear the group', async () => {
    const process = new Process(),
      clock = harness(true)
    const failure = new Error('group drain timed out')
    clock.deps.waitForProcessGroupExit = async (_processGroupId, timeoutMs) => {
      expect(timeoutMs).toBe(20)
      throw failure
    }
    const outcome = runBrowserSession(options(process), clock.deps).then(
      () => undefined,
      (error: unknown) => error,
    )
    process.emit('close', 0, null)
    clock.triggerGrace()

    await expect(outcome).resolves.toBe(failure)
    expect(process.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('rejects a classifier failure only after supervised cleanup completes', async () => {
    const process = new Process(),
      clock = harness(true)
    const failure = new Error('unexpected browser output')
    const outcome = runBrowserSession(
      {
        ...options(process),
        onLine: () => {
          throw failure
        },
      },
      clock.deps,
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    process.stdout.emit('data', 'bad output\n')
    process.stderr.emit('data', 'another bad output\n')
    expect(process.signals).toEqual(['SIGTERM'])
    process.emit('close', null, 'SIGTERM')
    await Promise.resolve()
    clock.triggerGrace()
    clock.release()

    await expect(outcome).resolves.toBe(failure)
  })

  it('rejects a classifier failure surfaced while flushing a final output line', async () => {
    const process = new Process(),
      clock = harness()
    const failure = new Error('unterminated browser output')
    const outcome = runBrowserSession(
      {
        ...options(process),
        onLine: () => {
          throw failure
        },
      },
      clock.deps,
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    process.stdout.emit('data', 'final output')
    process.emit('close', 0, null)

    await expect(outcome).resolves.toBe(failure)
    expect(process.signals).toEqual(['SIGTERM'])
  })

  it('keeps the default parent handler through repeated signals until cleanup completes', async () => {
    const process = new Process()
    const originalListenerCount = globalThis.process.listenerCount('SIGTERM')
    const kill = vi.spyOn(globalThis.process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      return true
    })
    const run = runBrowserSession(options(process))
    expect(globalThis.process.listenerCount('SIGTERM')).toBe(originalListenerCount + 1)

    globalThis.process.emit('SIGTERM')
    globalThis.process.emit('SIGTERM')
    expect(process.signals).toEqual(['SIGTERM'])
    expect(globalThis.process.listenerCount('SIGTERM')).toBe(originalListenerCount + 1)
    process.emit('close', null, 'SIGTERM')

    await expect(run).resolves.toMatchObject({ reason: 'parent-signal' })
    expect(globalThis.process.listenerCount('SIGTERM')).toBe(originalListenerCount)
    kill.mockRestore()
  })

  it("rejects a process group ID above Node's supported PID range", async () => {
    const process = new Process()
    process.processGroupId = 2_147_483_648

    await expect(runBrowserSession(options(process), harness().deps)).rejects.toThrow(
      'processGroupId',
    )
    expect(process.signals).toEqual(['SIGKILL'])
  })
})
