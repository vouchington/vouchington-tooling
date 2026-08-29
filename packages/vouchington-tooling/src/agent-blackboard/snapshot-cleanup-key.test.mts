import { mkdtemp, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadCleanupSigningKey,
  setCleanupKeyTempDirectoryForTest,
} from './snapshot-cleanup-key.mts'

const paths = new Set<string>()
afterEach(async () => {
  setCleanupKeyTempDirectoryForTest()
  await Promise.all([...paths].map((path) => rm(path, { recursive: true, force: true })))
  paths.clear()
})

describe('snapshot cleanup signing key', () => {
  it('creates one owner-only key for concurrent callers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snapshot-key-'))
    paths.add(root)
    setCleanupKeyTempDirectoryForTest(() => root)
    const keys = await Promise.all(Array.from({ length: 8 }, () => loadCleanupSigningKey()))
    expect(keys.every((key) => key.equals(keys[0]!))).toBe(true)
    const directory = join(root, `agent-blackboard-cleanup-${process.geteuid!()}`)
    expect((await stat(directory)).mode & 0o777).toBe(0o700)
    expect((await stat(join(directory, 'receipt-hmac-sha256.key'))).mode & 0o777).toBe(0o600)
  })

  it('fails closed for a symlinked key directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snapshot-key-'))
    const target = await mkdtemp(join(tmpdir(), 'snapshot-key-target-'))
    paths.add(root)
    paths.add(target)
    const directory = join(root, `agent-blackboard-cleanup-${process.geteuid!()}`)
    await symlink(target, directory)
    setCleanupKeyTempDirectoryForTest(() => root)
    await expect(loadCleanupSigningKey()).rejects.toThrow('not owner-only')
  })
})
