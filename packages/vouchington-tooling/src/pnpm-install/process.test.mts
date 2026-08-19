import { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'

// oxfmt-ignore
import { INSTALL_TERMINATION_FAILED, installExitCode, safeProcessGroup, startInstallHeartbeat, terminateProcessGroup, terminateSafeProcessGroup } from './process.mts'

describe('pnpm install process termination', () => {
  it('never converts a missing or invalid child PID into process group zero', () => {
    expect(safeProcessGroup(undefined)).toBeUndefined()
    expect(safeProcessGroup(0)).toBeUndefined()
    expect(safeProcessGroup(-1)).toBeUndefined()
    expect(safeProcessGroup(42)).toBe(42)
  })

  it('fails a timed out install even if its child subsequently reports zero', () => {
    expect(INSTALL_TERMINATION_FAILED).toBe(-1)
    expect(installExitCode(0, true)).toBe(1)
    expect(installExitCode(0, false)).toBe(0)
    expect(installExitCode(2, false)).toBe(2)
    expect(installExitCode(null, false)).toBe(1)
  })

  it('waits through TERM grace and KILL cleanup before an install attempt can retry', async () => {
    const signals: NodeJS.Signals[] = []
    const waits: number[] = []
    const stopped = await terminateProcessGroup(42, {
      isAlive: () => true,
      signal: (_, signal) => signals.push(signal),
      waitForExit: async (_, timeoutMs) => {
        waits.push(timeoutMs)
        return waits.length === 2
      },
    })
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(waits).toEqual([10_000, 10_000])
    expect(stopped).toBe(true)
  })

  it('bounds the post-KILL wait when descendants survive', async () => {
    const waits: number[] = []
    const stopped = await terminateProcessGroup(42, {
      isAlive: () => true,
      signal: () => undefined,
      waitForExit: async (_, timeoutMs) => {
        waits.push(timeoutMs)
        return false
      },
    })
    expect(waits).toEqual([10_000, 10_000])
    expect(stopped).toBe(false)
  })

  it('accepts a process group that exits between the liveness check and TERM', async () => {
    await expect(
      terminateProcessGroup(42, {
        isAlive: () => true,
        signal: () => {
          throw Object.assign(new Error('gone'), { code: 'ESRCH' })
        },
        waitForExit: async () => true,
      }),
    ).resolves.toBe(true)
  })

  it('returns immediately when the process group is already gone', async () => {
    await expect(
      terminateProcessGroup(42, {
        isAlive: () => false,
        signal: () => {
          throw new Error('should not signal')
        },
        waitForExit: async () => false,
      }),
    ).resolves.toBe(true)
  })

  it('stops after TERM when the group exits during grace', async () => {
    await expect(
      terminateProcessGroup(42, {
        isAlive: () => true,
        signal: () => undefined,
        waitForExit: async () => true,
      }),
    ).resolves.toBe(true)
  })

  it('rethrows unexpected signals and treats a missing pid as unsafe', async () => {
    await expect(
      terminateProcessGroup(42, {
        isAlive: () => true,
        signal: () => {
          throw Object.assign(new Error('eperm'), { code: 'EPERM' })
        },
        waitForExit: async () => false,
      }),
    ).rejects.toThrow('eperm')
    await expect(terminateSafeProcessGroup(undefined)).resolves.toBe(false)
    await expect(terminateSafeProcessGroup(0)).resolves.toBe(false)
  })

  it('treats KILL ESRCH as a successful teardown', async () => {
    await expect(
      terminateProcessGroup(42, {
        isAlive: () => true,
        signal: (_group, signal) => {
          if (signal === 'SIGKILL') throw Object.assign(new Error('gone'), { code: 'ESRCH' })
        },
        waitForExit: async () => false,
      }),
    ).resolves.toBe(true)
  })

  it('emits a heartbeat and reaps a live detached child', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const heartbeat = startInstallHeartbeat()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(warn.mock.calls.some((call) => String(call[0]).includes('still running'))).toBe(true)
      clearInterval(heartbeat)
    } finally {
      vi.useRealTimers()
      warn.mockRestore()
    }
    const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' })
    child.unref()
    await expect(terminateSafeProcessGroup(child.pid)).resolves.toBe(true)
  })
})
