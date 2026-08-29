import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupSnapshotPartitions, partitionSnapshot } from './snapshot.mts'
import { writeCleanupReceipt } from './snapshot-cleanup-receipt.mts'
import { setSnapshotCleanupFilesystemForTest } from './snapshot-partition-cleanup.mts'
import { setSnapshotFilesystemForTest } from './snapshot-partitions.mts'

const paths = new Set<string>()
afterEach(async () => {
  setSnapshotFilesystemForTest()
  setSnapshotCleanupFilesystemForTest()
  await Promise.all([...paths].map((path) => rm(path, { recursive: true, force: true })))
  paths.clear()
})

function records(): object[] {
  const session = {
    id: 'session:one',
    parentSessionId: null,
    agent: 'agent',
    version: '1',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastEntryAt: null,
    archivedAt: null,
    data: {},
  }
  return [
    { type: 'session', session },
    { type: 'entry', entry: { sessionId: session.id, createdAt: session.createdAt, data: {} } },
    {
      type: 'manifest',
      manifest: {
        schemaVersion: 1,
        status: 'complete',
        createdAt: session.createdAt,
        completedAt: '2026-01-01T00:01:00.000Z',
        selection: { archived: false },
        counts: { sessions: 1, entries: 1, records: 3 },
        ordering: {
          sessions: 'createdAt ascending',
          entries: 'createdAt ascending within session',
        },
        consistency: 'best-effort',
      },
    },
  ]
}

async function snapshot(
  content: string | Uint8Array = `${records()
    .map((record) => JSON.stringify(record))
    .join('\n')}\n`,
): Promise<string> {
  const path = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  await writeFile(path, content, { mode: 0o400 })
  paths.add(path)
  return path
}

function sourceClosure(): { closed: () => boolean; open: typeof open } {
  let closed = false
  return {
    closed: () => closed,
    open: (async (...args: Parameters<typeof open>) => {
      const handle = await open(...args)
      const original = handle.close.bind(handle)
      handle.close = async () => {
        closed = true
        return original()
      }
      return handle
    }) as typeof open,
  }
}

describe('snapshot resource failures', () => {
  it.each(['open', 'first mkdtemp', 'second mkdtemp', 'chmod'] as const)(
    'closes the source and leaves no artifacts when %s fails',
    async (failure) => {
      const path = await snapshot()
      const closure = sourceClosure()
      const created: string[] = []
      let mkdirs = 0
      let chmods = 0
      setSnapshotFilesystemForTest({
        ...(failure === 'open'
          ? { open: async () => Promise.reject(new Error('open failed')) }
          : { open: closure.open }),
        mkdtemp: (async (prefix: string) => {
          mkdirs += 1
          if (
            (failure === 'first mkdtemp' && mkdirs === 1) ||
            (failure === 'second mkdtemp' && mkdirs === 2)
          )
            throw new Error(`${failure} failed`)
          const directory = await mkdtemp(prefix)
          created.push(directory)
          return directory
        }) as typeof mkdtemp,
        chmod: async (target, mode) => {
          chmods += 1
          if (failure === 'chmod' && chmods === 1) throw new Error('chmod failed')
          return chmod(target, mode)
        },
      })
      await expect(partitionSnapshot({ path })).rejects.toThrow(`${failure} failed`)
      expect(closure.closed()).toBe(failure !== 'open')
      await Promise.all(created.map((directory) => expect(stat(directory)).rejects.toThrow()))
    },
  )

  it('restores a tombstoned snapshot after removal fails and cleans it on retry', async () => {
    const path = await snapshot()
    const content = await readFile(path, 'utf8')
    let failed = false
    setSnapshotCleanupFilesystemForTest({
      rm: async (target, options) => {
        if (!failed && String(target).includes('.agent-blackboard-cleanup-')) {
          failed = true
          throw new Error('tombstone removal failed')
        }
        return rm(target, options)
      },
    })
    await expect(cleanupSnapshotPartitions({ path })).rejects.toThrow('restored')
    await expect(readFile(path, 'utf8')).resolves.toBe(content)
    setSnapshotCleanupFilesystemForTest()
    await expect(cleanupSnapshotPartitions({ path })).resolves.toBeUndefined()
    paths.delete(path)
  })

  it('includes a non-Error tombstone removal failure after successful rollback', async () => {
    const path = await snapshot()
    setSnapshotCleanupFilesystemForTest({
      rm: async (target, options) => {
        if (String(target).includes('.agent-blackboard-cleanup-')) throw 'removal failed'
        return rm(target, options)
      },
    })
    await expect(cleanupSnapshotPartitions({ path })).rejects.toThrow(
      'restored ' + path + ' for retry',
    )
    await expect(readFile(path)).resolves.toBeTruthy()
  })

  it('reports an aggregate and leaves retry evidence when tombstone rollback fails', async () => {
    const path = await snapshot()
    let renames = 0
    setSnapshotCleanupFilesystemForTest({
      rm: async (target) => {
        if (String(target).includes('.agent-blackboard-cleanup-'))
          throw new Error('tombstone removal failed')
        return rm(target, { force: true })
      },
      rename: async (from, to) => {
        renames += 1
        if (renames === 2) throw new Error('rollback rename failed')
        const { rename } = await import('node:fs/promises')
        return rename(from, to)
      },
    })
    let error: unknown
    try {
      await cleanupSnapshotPartitions({ path })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as Error).message).toContain(path)
    expect((error as Error).message).toContain('.agent-blackboard-cleanup-')
    const nested = (error as AggregateError).errors[0] as AggregateError
    expect(nested).toBeInstanceOf(AggregateError)
    expect(nested.errors.map(String)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('tombstone removal failed'),
        expect.stringContaining('rollback rename failed'),
      ]),
    )
    await expect(readFile(path)).rejects.toThrow()
    const tombstone = (await readdir(tmpdir())).find((name) =>
      name.startsWith('.agent-blackboard-cleanup-'),
    )
    expect(tombstone).toBeDefined()
    paths.add(join(tmpdir(), tombstone!))
  })

  it('preserves a caller-created valid lookalike without a cleanup receipt', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), `agent-blackboard-partitions-${randomUUID().replaceAll('-', '')}`),
    )
    const partition = join(directory, 'partition-1.jsonl')
    const content = `${records()
      .map((item) => JSON.stringify(item))
      .join('\n')}\n`
    await writeFile(partition, content, { mode: 0o400 })
    paths.add(directory)
    await expect(cleanupSnapshotPartitions({ directory })).rejects.toThrow('requires a receipt')
    await expect(readFile(partition, 'utf8')).resolves.toBe(content)
  })

  it('restores a replacement directory detected after it is captured', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), `agent-blackboard-partitions-${randomUUID().replaceAll('-', '')}`),
    )
    const partition = join(directory, 'partition-1.jsonl')
    const content = `${records()
      .map((item) => JSON.stringify(item))
      .join('\n')}\n`
    await writeFile(partition, content, { mode: 0o400 })
    const receipt = await writeCleanupReceipt(directory, [
      {
        path: partition,
        checksum: {
          algorithm: 'sha256',
          value: createHash('sha256').update(content).digest('hex'),
        },
      },
    ])
    paths.add(directory)
    let replaced = false
    setSnapshotCleanupFilesystemForTest({
      lstat: (async (path: Parameters<typeof lstat>[0]) => {
        const info = await lstat(path)
        if (!replaced && path === directory) {
          replaced = true
          await rm(directory, { recursive: true, force: true })
          await mkdir(directory)
          await writeFile(join(directory, 'replacement'), 'keep')
        }
        if (String(path).includes('.agent-blackboard-cleanup-'))
          return Object.assign(Object.create(Object.getPrototypeOf(info)), info, {
            ino: Number(info.ino) + 1,
          }) as typeof info
        return info
      }) as typeof lstat,
    })
    await expect(cleanupSnapshotPartitions({ directory, receipt })).rejects.toThrow('changed while')
    await expect(readFile(join(directory, 'replacement'), 'utf8')).resolves.toBe('keep')
  })

  it('requires a matching receipt before it removes generated partitions', async () => {
    const path = await snapshot()
    const result = await partitionSnapshot({ path })
    paths.add(result.directory)
    await expect(cleanupSnapshotPartitions({ directory: result.directory })).rejects.toThrow(
      'requires a receipt',
    )
    await expect(
      cleanupSnapshotPartitions({
        directory: result.directory,
        receipt: { ...result.cleanupReceipt, token: randomUUID() },
      }),
    ).rejects.toThrow('signature is invalid')
    await expect(
      cleanupSnapshotPartitions({
        directory: result.directory,
        receipt: { ...result.cleanupReceipt, directoryIno: 0 },
      }),
    ).rejects.toThrow('signature is invalid')
    await expect(
      cleanupSnapshotPartitions({ directory: result.directory, receipt: result.cleanupReceipt }),
    ).resolves.toBeUndefined()
    paths.delete(result.directory)
  })

  it('rejects same-size source mutations and malformed UTF-8', async () => {
    const path = await snapshot()
    await chmod(path, 0o600)
    const original = await readFile(path, 'utf8')
    const probe = await open(path, 'r')
    const prototype = Object.getPrototypeOf(probe) as {
      read: (...args: unknown[]) => Promise<{ bytesRead: number }>
    }
    await probe.close()
    const read = prototype.read
    let mutated = false
    prototype.read = async function (...args: unknown[]): Promise<{ bytesRead: number }> {
      const result = await read.apply(this, args)
      if (!mutated && result.bytesRead === 0) {
        mutated = true
        await writeFile(path, original.replace('session:one', 'session:uno'))
      }
      return result
    }
    try {
      await expect(partitionSnapshot({ path })).rejects.toThrow('changed while it was being read')
    } finally {
      prototype.read = read
    }
    const invalid = await snapshot(Buffer.from([0xc3, 0x28]))
    await expect(partitionSnapshot({ path: invalid })).rejects.toThrow('valid for encoding')
  })
})
