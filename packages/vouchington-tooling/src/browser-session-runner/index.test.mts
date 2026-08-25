import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import {
  runBrowserSession,
  type BrowserSessionDeps,
  type BrowserSessionExit,
  type BrowserSessionProcess,
} from './index.mts'

class FakeProcess extends EventEmitter implements BrowserSessionProcess {
  pid = 42
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
  const timeouts: Array<() => void> = []
  const parent = new EventEmitter()
  const processGroups: NodeJS.Signals[] = []
  const deps: BrowserSessionDeps = {
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
    killProcessGroup: (_pid, signal) => processGroups.push(signal),
    now: () => now,
    offParentSignal: (signal, listener) => parent.off(signal, listener),
    onParentSignal: (signal, listener) => parent.once(signal, listener),
    setInterval: (callback) => (intervals.push(callback), callback),
    setTimeout: (callback) => (timeouts.push(callback), callback),
  }
  return {
    deps,
    emitSignal: (signal: NodeJS.Signals) => parent.emit(signal),
    processGroups,
    runTimeouts: () => timeouts.forEach((callback) => callback()),
    tick: (ms: number) => {
      now += ms
      intervals.forEach((callback) => callback())
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
    const run = runBrowserSession(options([child]), clock.deps)
    child.stdout.emit('data', 'rea')
    child.stderr.emit('data', 'dy\ntest 1\nlong-tail')
    child.emit('close', 0, null)
    await expect(run).resolves.toMatchObject({
      diagnosticTail: 'ready\ntest 1\nlong-tail',
      semanticProgress: true,
      startupProgress: true,
    })
  })

  it('terminates a startup stall with TERM followed by KILL', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(options([child]), clock.deps)
    clock.tick(20)
    clock.runTimeouts()
    child.emit('close', null, 'SIGKILL')
    await expect(run).resolves.toMatchObject({ reason: 'startup-stall' })
    expect(clock.processGroups).toEqual(['SIGTERM', 'SIGKILL'])
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('terminates a semantic progress stall after startup completes', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(options([child]), clock.deps)
    child.stdout.emit('data', 'ready\ntest 1\n')
    clock.tick(20)
    child.emit('close', null, 'SIGTERM')
    await expect(run).resolves.toMatchObject({ reason: 'semantic-stall' })
    expect(clock.processGroups).toEqual(['SIGTERM'])
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

  it('terminates the process group when the parent receives a signal', async () => {
    const child = new FakeProcess()
    const clock = makeClock()
    const run = runBrowserSession(options([child]), clock.deps)
    clock.emitSignal('SIGTERM')
    child.emit('close', null, 'SIGTERM')
    await expect(run).resolves.toMatchObject({ reason: 'parent-signal' })
    expect(clock.processGroups).toEqual(['SIGTERM'])
  })
})
