import { constants } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const createFailure = vi.hoisted(() => ({ value: false }))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      if (createFailure.value && typeof args[1] === 'number' && args[1] & constants.O_EXCL)
        throw new Error('exclusive create failed')
      return actual.open(...args)
    },
  }
})

import {
  loadCleanupSigningKey,
  setCleanupKeyTempDirectoryForTest,
} from './snapshot-cleanup-key.mts'

let root: string | undefined
afterEach(async () => {
  createFailure.value = false
  setCleanupKeyTempDirectoryForTest()
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('snapshot cleanup signing key creation', () => {
  it('surfaces non-race exclusive creation failures', async () => {
    root = await mkdtemp(join(tmpdir(), 'snapshot-key-'))
    setCleanupKeyTempDirectoryForTest(() => root!)
    createFailure.value = true
    await expect(loadCleanupSigningKey()).rejects.toThrow('exclusive create failed')
  })
})
