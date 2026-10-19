import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const execFile = vi.hoisted(() => {
  const custom = Symbol.for('nodejs.util.promisify.custom')
  const fn = vi.fn()
  Object.defineProperty(fn, custom, {
    value: () => Promise.resolve({ stderr: '', stdout: '/tmp\n' }),
  })
  return fn
})
vi.mock('node:child_process', () => ({ execFile }))

import { requiredPath } from './host-storage.test-helpers.mts'
import { inspectHostStorage } from './preflight.mts'

describe('default host storage command runner', () => {
  it('reads command stdout without launching pnpm', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'host-storage-exec-'))
    try {
      const result = await inspectHostStorage({
        discoverPnpmStore: true,
        minimumFreeBytes: 0n,
        paths: [requiredPath('directory', dir)],
      })
      expect(result.ok).toBe(true)
      expect(
        result.filesystems.some((filesystem) => filesystem.labels.includes('pnpm store')),
      ).toBe(true)
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  })
})
