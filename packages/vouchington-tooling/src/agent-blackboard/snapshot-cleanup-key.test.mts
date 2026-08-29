import { mkdir, mkdtemp, rm, stat, symlink, writeFile, link, lstat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  loadCleanupSigningKey,
  setCleanupKeyFilesystemForTest,
  setCleanupKeyTempDirectoryForTest,
} from './snapshot-cleanup-key.mts'

const paths = new Set<string>()
afterEach(async () => {
  setCleanupKeyTempDirectoryForTest()
  setCleanupKeyFilesystemForTest()
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

  it('publishes a complete winner before a loser reads it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snapshot-key-'))
    paths.add(root)
    setCleanupKeyTempDirectoryForTest(() => root)
    const keys = await Promise.all([loadCleanupSigningKey(), loadCleanupSigningKey()])
    expect(keys[0]!.equals(keys[1]!)).toBe(true)
  })

  it('waits for the publisher to unlink its temporary key hard link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snapshot-key-'))
    paths.add(root)
    setCleanupKeyTempDirectoryForTest(() => root)
    await loadCleanupSigningKey()
    await expect(loadCleanupSigningKey()).resolves.toHaveLength(32)
  })

  it('retries when a temporary key link disappears during recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snapshot-key-'))
    paths.add(root)
    setCleanupKeyTempDirectoryForTest(() => root)
    await loadCleanupSigningKey()
    const directory = join(root, `agent-blackboard-cleanup-${process.geteuid!()}`)
    const key = join(directory, 'receipt-hmac-sha256.key')
    const staging = join(directory, `.receipt-hmac-sha256.key.${randomUUID()}`)
    await link(key, staging)
    let vanished = false
    setCleanupKeyFilesystemForTest({
      lstat: (async (path: Parameters<typeof lstat>[0]) => {
        if (!vanished && path === staging) {
          vanished = true
          await unlink(staging)
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        }
        return lstat(path)
      }) as typeof lstat,
    })
    await expect(loadCleanupSigningKey()).resolves.toHaveLength(32)
  })

  it('rejects two-link key recovery without a matching temporary name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snapshot-key-'))
    paths.add(root)
    setCleanupKeyTempDirectoryForTest(() => root)
    await loadCleanupSigningKey()
    const directory = join(root, `agent-blackboard-cleanup-${process.geteuid!()}`)
    const key = join(directory, 'receipt-hmac-sha256.key')
    await link(key, join(directory, `.receipt-hmac-sha256.key.not-a-uuid`))
    await expect(loadCleanupSigningKey()).rejects.toThrow('unsafe temporary link')
  })

  it('ignores a vanished temporary key file after publishing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snapshot-key-'))
    paths.add(root)
    setCleanupKeyTempDirectoryForTest(() => root)
    let removed = false
    setCleanupKeyFilesystemForTest({
      unlink: (async (path: Parameters<typeof unlink>[0]) => {
        if (!removed && String(path).includes('.receipt-hmac-sha256.key.')) {
          removed = true
          await unlink(path)
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        }
        return unlink(path)
      }) as typeof unlink,
    })
    await expect(loadCleanupSigningKey()).resolves.toHaveLength(32)
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

  it('surfaces non-race directory errors and invalid existing key lengths', async () => {
    setCleanupKeyTempDirectoryForTest(() => join(tmpdir(), `missing-key-root-${Date.now()}`))
    await expect(loadCleanupSigningKey()).rejects.toThrow('ENOENT')
    const root = await mkdtemp(join(tmpdir(), 'snapshot-key-'))
    paths.add(root)
    setCleanupKeyTempDirectoryForTest(() => root)
    const directory = join(root, `agent-blackboard-cleanup-${process.geteuid!()}`)
    await mkdir(directory, { mode: 0o700 })
    await writeFile(join(directory, 'receipt-hmac-sha256.key'), 'short', { mode: 0o600 })
    await expect(loadCleanupSigningKey()).rejects.toThrow('invalid length')
  })
})
