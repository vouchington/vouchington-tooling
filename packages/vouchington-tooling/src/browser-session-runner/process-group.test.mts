import { describe, expect, it, vi } from 'vitest'

import { isProcessGroupAlive, waitForProcessGroupExit } from './process-group.mts'

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

  it('polls a live process group until it exits', async () => {
    vi.useFakeTimers()
    let probes = 0
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      probes += 1
      if (probes === 3) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      return true
    })

    const wait = waitForProcessGroupExit(42)
    await vi.advanceTimersByTimeAsync(20)
    await expect(wait).resolves.toBeUndefined()
    expect(probes).toBe(3)

    kill.mockRestore()
    vi.useRealTimers()
  })
})
