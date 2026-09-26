import { describe, expect, it } from 'vitest'

import { withAuditSignalCleanup } from './audit-signals.mts'

describe('license audit signals', () => {
  it('removes the default handlers when the audit finishes', async () => {
    const before = process.listenerCount('SIGHUP')
    await withAuditSignalCleanup(
      () => undefined,
      async () => {
        expect(process.listenerCount('SIGHUP')).toBe(before + 1)
        return 'ok'
      },
    )
    expect(process.listenerCount('SIGHUP')).toBe(before)
  })

  it('cleans up and re-raises the first signal', async () => {
    const raised: NodeJS.Signals[] = []
    const listeners = new Map<NodeJS.Signals, () => void>()
    let cleaned = false
    await expect(
      withAuditSignalCleanup(
        () => {
          cleaned = true
        },
        async (signal) => {
          listeners.get('SIGINT')?.()
          listeners.get('SIGTERM')?.()
          expect(signal.aborted).toBe(true)
          expect(signal.reason).toBe('SIGINT')
          return 'ignored'
        },
        {
          raiseSignal: (signal) => {
            raised.push(signal)
          },
          subscribe: (signal, listener) => {
            listeners.set(signal, listener)
          },
          unsubscribe: (signal) => {
            listeners.delete(signal)
          },
        },
      ),
    ).resolves.toBe('ignored')
    expect(cleaned).toBe(true)
    expect(raised).toEqual(['SIGINT'])
    expect(listeners.size).toBe(0)
  })

  it('raises the process signal when no custom raiser is provided', async () => {
    const calls: Array<{ pid: number; signal: NodeJS.Signals | number | undefined }> = []
    const original = process.kill.bind(process)
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      calls.push({ pid, signal })
      return true
    }) as typeof process.kill
    try {
      let listener: (() => void) | undefined
      await withAuditSignalCleanup(
        () => undefined,
        async () => {
          listener?.()
        },
        {
          subscribe: (signal, next) => {
            if (signal === 'SIGTERM') listener = next
          },
          unsubscribe: () => undefined,
        },
      )
      expect(calls).toEqual([{ pid: process.pid, signal: 'SIGTERM' }])
    } finally {
      process.kill = original as typeof process.kill
    }
  })

  it('still re-raises when cleanup fails', async () => {
    const raised: NodeJS.Signals[] = []
    let listener: (() => void) | undefined
    await expect(
      withAuditSignalCleanup(
        () => {
          throw new Error('cleanup failed')
        },
        async () => {
          listener?.()
        },
        {
          raiseSignal: (signal) => {
            raised.push(signal)
          },
          subscribe: (signal, next) => {
            if (signal === 'SIGINT') listener = next
          },
          unsubscribe: () => undefined,
        },
      ),
    ).rejects.toThrow('cleanup failed')
    expect(raised).toEqual(['SIGINT'])
  })
})
