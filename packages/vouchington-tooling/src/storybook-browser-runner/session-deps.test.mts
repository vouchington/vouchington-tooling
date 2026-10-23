import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeDeps } from './fixtures.test-helpers.mts'
import {
  DISABLED_STALL_TIMER_MS,
  createBrowserSessionDeps,
  defaultRunnerDeps,
} from './session-deps.mts'

afterEach(() => {
  vi.useRealTimers()
})

describe('defaultRunnerDeps', () => {
  it('signals the process group and tolerates one that is already gone', () => {
    const deps = defaultRunnerDeps()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    deps.killProcessGroup(4321, 'SIGTERM')
    expect(kill).toHaveBeenCalledWith(-4321, 'SIGTERM')
    kill.mockImplementation(() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })
    expect(() => deps.killProcessGroup(4321, 'SIGKILL')).not.toThrow()
    kill.mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' })
    })
    expect(() => deps.killProcessGroup(4321, 'SIGKILL')).toThrow('denied')
    kill.mockRestore()
  })

  it('wires the process signal listeners and a wall clock', () => {
    const deps = defaultRunnerDeps()
    const listener = vi.fn()
    const before = process.listenerCount('SIGUSR2')
    deps.onParentSignal('SIGUSR2', listener)
    expect(process.listenerCount('SIGUSR2')).toBe(before + 1)
    deps.offParentSignal('SIGUSR2', listener)
    expect(process.listenerCount('SIGUSR2')).toBe(before)
    expect(deps.cwd).toBe(process.cwd())
    expect(typeof deps.now()).toBe('number')
  })
})

describe('createBrowserSessionDeps', () => {
  it('delegates ordinary timers to the injected deps', () => {
    const harness = makeDeps([])
    const calls: number[] = []
    harness.deps.setTimeout = ((_cb: () => void, ms: number) => (calls.push(ms), { ms })) as never
    const cleared: unknown[] = []
    harness.deps.clearTimeout = ((handle: unknown) => cleared.push(handle)) as never
    const session = createBrowserSessionDeps(harness.deps)
    const handle = session.setTimeout(() => undefined, 50)
    session.clearTimeout(handle)
    expect(calls).toEqual([50])
    expect(cleared).toEqual([handle])
    expect(session.now()).toBe(0)
  })

  it('uses unref native timers for the disabled stall sentinels', () => {
    vi.useFakeTimers()
    const harness = makeDeps([])
    const cleared: unknown[] = []
    harness.deps.clearTimeout = ((handle: unknown) => cleared.push(handle)) as never
    const session = createBrowserSessionDeps(harness.deps)
    const fired = vi.fn()
    const sentinel = session.setTimeout(fired, DISABLED_STALL_TIMER_MS)
    session.clearTimeout(sentinel)
    vi.advanceTimersByTime(DISABLED_STALL_TIMER_MS)
    expect(fired).not.toHaveBeenCalled()
    expect(cleared).toEqual([])
    session.setTimeout(fired, DISABLED_STALL_TIMER_MS)
    vi.advanceTimersByTime(DISABLED_STALL_TIMER_MS)
    expect(fired).toHaveBeenCalledTimes(1)
  })

  it('tolerates timers without unref', () => {
    const timer = { unref: undefined }
    const spy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timer as never)
    const session = createBrowserSessionDeps(makeDeps([]).deps)
    expect(session.setTimeout(() => undefined, DISABLED_STALL_TIMER_MS)).toBe(timer)
    spy.mockRestore()
  })
})
