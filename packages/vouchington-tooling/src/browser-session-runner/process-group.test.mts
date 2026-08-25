import { describe, expect, it, vi } from 'vitest'

import {
  isProcessGroupAlive,
  ProcessGroupDrainTimeoutError,
  waitForProcessGroupExit,
} from './process-group.mts'

describe('process-group lifecycle', () => {
  it('treats only a missing process group as exited', () => {
    const kill = vi.spyOn(process, 'kill')
    kill.mockReturnValue(true)
    expect(isProcessGroupAlive(42)).toBe(true)

    kill.mockImplementation(() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })
    expect(isProcessGroupAlive(42)).toBe(false)

    kill.mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' })
    })
    expect(isProcessGroupAlive(42)).toBe(true)
    expect(kill).toHaveBeenCalledWith(-42, 0)
    kill.mockRestore()
  })

  it('rejects unsupported platforms and unsafe public inputs before probing', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(() => isProcessGroupAlive(42)).toThrow('unsupported on Windows')
    await expect(waitForProcessGroupExit(42, 20)).rejects.toThrow('unsupported on Windows')
    platform.mockRestore()
    for (const processGroupId of [0, 1, -1, 1.5, Infinity, 2_147_483_648])
      expect(() => isProcessGroupAlive(processGroupId)).toThrow('processGroupId')
    for (const timeoutMs of [0, -1, 1.5, Infinity, 2_147_483_648])
      await expect(waitForProcessGroupExit(42, timeoutMs)).rejects.toThrow('timeoutMs')
  })

  it('polls a live process group until it exits', async () => {
    vi.useFakeTimers()
    let probes = 0
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      probes += 1
      if (probes === 3) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      return true
    })

    const wait = waitForProcessGroupExit(42, 20)
    await vi.advanceTimersByTimeAsync(20)
    await expect(wait).resolves.toBeUndefined()
    expect(probes).toBe(3)

    kill.mockRestore()
    vi.useRealTimers()
  })

  it('rejects when a group remains observable after the drain budget', async () => {
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const wait = waitForProcessGroupExit(42, 20)
    const rejection = expect(wait).rejects.toBeInstanceOf(ProcessGroupDrainTimeoutError)
    await vi.advanceTimersByTimeAsync(20)

    await rejection
    kill.mockRestore()
    vi.useRealTimers()
  })
})
