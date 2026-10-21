import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkAndRestoreFakeTimers,
  type FakeTimerController,
  formatFakeTimerLeakDiagnostics,
} from './vitest-fake-timer-guard.mts'

// A directly-controllable stand-in for vitest's `vi`, so the leak/no-leak branches are
// deterministic and don't depend on globally mutating the real fake-timer clock.
function createFakeController(initiallyFake: boolean): FakeTimerController & { restored: boolean } {
  let fake = initiallyFake
  const controller = {
    restored: false,
    isFakeTimers: () => fake,
    useRealTimers: () => {
      fake = false
      controller.restored = true
    },
  }
  return controller
}

describe('checkAndRestoreFakeTimers', () => {
  it('returns null and leaves the controller untouched when real timers are already active', () => {
    const controller = createFakeController(false)

    expect(checkAndRestoreFakeTimers(controller, 'some test')).toBeNull()
    expect(controller.restored).toBe(false)
  })

  it('returns a diagnostic and restores real timers when fake timers were left installed', () => {
    const controller = createFakeController(true)

    const message = checkAndRestoreFakeTimers(controller, 'leaves fake timers on')

    expect(message).toBe(formatFakeTimerLeakDiagnostics('leaves fake timers on'))
    expect(controller.restored).toBe(true)
    expect(controller.isFakeTimers()).toBe(false)
  })

  it('restores real timers even though the diagnostic reports the leak, not silently', () => {
    const controller = createFakeController(true)

    checkAndRestoreFakeTimers(controller, 'irrelevant')

    // The whole point of restoring inline (rather than only reporting) is that a later test
    // sharing this fork/file never observes the fake clock this test forgot to restore.
    expect(controller.isFakeTimers()).toBe(false)
  })
})

describe('formatFakeTimerLeakDiagnostics', () => {
  it('names the offending test and explains the fix', () => {
    const message = formatFakeTimerLeakDiagnostics('my suite > my test')

    expect(message).toContain('[vitest-fake-timer-leak]')
    expect(message).toContain('test: my suite > my test')
    expect(message).toContain('vi.useRealTimers()')
  })
})

describe('checkAndRestoreFakeTimers against the real vitest vi API', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is null when the real vi has not switched to fake timers', () => {
    expect(checkAndRestoreFakeTimers(vi, 'real vi, no fake timers')).toBeNull()
  })

  it('detects and clears the real vi fake-timer state left on by a prior test', () => {
    vi.useFakeTimers()
    expect(vi.isFakeTimers()).toBe(true)

    const message = checkAndRestoreFakeTimers(vi, 'real vi, left fake timers on')

    expect(message).not.toBeNull()
    expect(vi.isFakeTimers()).toBe(false)
  })
})
