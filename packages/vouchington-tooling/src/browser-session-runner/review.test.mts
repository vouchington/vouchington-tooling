import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

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
  const parent = new EventEmitter()
  let release: () => void = () => {}
  const exited = new Promise<void>((resolve) => {
    release = resolve
  })
  const deps: BrowserSessionDeps = {
    clearInterval: () => {},
    clearTimeout: () => {},
    isProcessGroupAlive: () => alive,
    killProcessGroup: () => {},
    now: () => now,
    offParentSignal: (signal, listener) => parent.off(signal, listener),
    onParentSignal: (signal, listener) => parent.once(signal, listener),
    setInterval: (callback) => ((watchdog = callback), callback),
    setTimeout: (callback, ms) => {
      if (ms === 10) grace = callback
      return callback
    },
    waitForProcessGroupExit: () => exited,
  }
  return {
    deps,
    emitParent: () => parent.emit('SIGTERM'),
    release: () => release(),
    tick: (ms: number) => {
      now += ms
      watchdog()
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
    clock.triggerGrace()
    expect(process.signals).toEqual(['SIGTERM', 'SIGKILL'])
    clock.release()

    await expect(run).resolves.toMatchObject({ exit: { code: 0 } })
  })

  it('completes cleanup when descendant draining rejects', async () => {
    const process = new Process(),
      clock = harness(true)
    clock.deps.waitForProcessGroupExit = async () => {
      throw new Error('group probe failed')
    }
    const run = runBrowserSession(options(process), clock.deps)
    process.emit('close', 0, null)

    await expect(run).resolves.toMatchObject({ exit: { code: 0 } })
    expect(process.signals).toEqual(['SIGTERM'])
  })
})
