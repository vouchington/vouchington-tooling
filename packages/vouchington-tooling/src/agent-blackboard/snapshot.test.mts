import { createHash, randomUUID } from 'node:crypto'
import {
  appendFile,
  chmod,
  link,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupSnapshotPartitions, partitionSnapshot } from './snapshot.mts'
import { setSnapshotFilesystemForTest } from './snapshot-partitions.mts'

const paths = new Set<string>()
afterEach(async () => {
  setSnapshotFilesystemForTest()
  await Promise.all([...paths].map((path) => rm(path, { recursive: true, force: true })))
  paths.clear()
})
function sourceRecords() {
  const sessions = ['one', 'two'].map((id, index) => ({
    id,
    parentSessionId: null,
    agent: 'agent',
    version: '1',
    createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
    lastEntryAt: null,
    archivedAt: null,
    data: {},
  }))
  return [
    ...sessions.flatMap((session) => [
      { type: 'session', session },
      {
        type: 'entry',
        entry: { sessionId: session.id, createdAt: session.createdAt, data: { id: session.id } },
      },
    ]),
    {
      type: 'manifest',
      manifest: {
        schemaVersion: 1,
        status: 'complete',
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:01:00.000Z',
        selection: { archived: false },
        counts: { sessions: 2, entries: 2, records: 5 },
        ordering: {
          sessions: 'createdAt ascending',
          entries: 'createdAt ascending within session',
        },
        consistency: 'best-effort',
      },
    },
  ]
}
async function snapshot(records: unknown[] = sourceRecords()): Promise<string> {
  const path = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, {
    mode: 0o400,
  })
  paths.add(path)
  return path
}
function verification(bytes: Buffer) {
  return {
    checksum: {
      algorithm: 'sha256' as const,
      value: createHash('sha256').update(bytes).digest('hex'),
    },
    counts: { sessions: 2, entries: 2, records: 5, bytes: bytes.byteLength },
  }
}
async function appendAfterSourceEof(path: string): Promise<() => void> {
  const probe = await open(path, 'r')
  const expected = await probe.stat()
  const prototype = Object.getPrototypeOf(probe) as {
    read: (...args: unknown[]) => Promise<{ bytesRead: number }>
  }
  await probe.close()
  const original = prototype.read
  let appended = false
  prototype.read = async function (
    this: { stat: () => Promise<{ dev: number; ino: number }> },
    ...args: unknown[]
  ): Promise<{ bytesRead: number }> {
    const result = await original.apply(this, args)
    const info = await this.stat()
    if (
      !appended &&
      result.bytesRead === 0 &&
      info.dev === expected.dev &&
      info.ino === expected.ino
    ) {
      appended = true
      await appendFile(path, '\n')
    }
    return result
  }
  return () => {
    prototype.read = original
  }
}

describe('snapshot partitions', () => {
  it('cleans acquired resources when setup operations fail', async () => {
    const path = await snapshot()
    setSnapshotFilesystemForTest({
      mkdtemp: async () => {
        throw new Error('injected mkdtemp failure')
      },
    })
    await expect(partitionSnapshot({ path })).rejects.toThrow('injected mkdtemp failure')
  })
  it('partitions complete sessions with read-only terminal manifests and verification metadata', async () => {
    const path = await snapshot()
    const bytes = await readFile(path)
    const result = await partitionSnapshot({ path, maxSessions: 1, ...verification(bytes) })
    paths.add(result.directory)
    expect(result.partitions).toHaveLength(2)
    expect((await stat(result.directory)).mode & 0o777).toBe(0o700)
    for (const partition of result.partitions) {
      const lines = (await readFile(partition.path, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(lines.at(-1).type).toBe('manifest')
      expect(lines.filter((line) => line.type === 'session')).toHaveLength(1)
      expect((await stat(partition.path)).mode & 0o777).toBe(0o400)
      expect(partition.counts.records).toBe(lines.length)
    }
    await cleanupSnapshotPartitions({
      path,
      directory: result.directory,
      receipt: result.cleanupReceipt,
    })
    paths.delete(path)
    paths.delete(result.directory)
    await expect(readFile(path)).rejects.toThrow()
    await expect(readdir(result.directory)).rejects.toThrow()
  })

  it('rejects arbitrary, hardlinked, symlinked, malformed, unverified, and oversized sources', async () => {
    const outside = join(await mkdtemp(join(tmpdir(), 'snapshot-outside-')), 'snapshot.jsonl')
    paths.add(outside)
    await writeFile(outside, '{}')
    await expect(partitionSnapshot({ path: outside })).rejects.toThrow(
      'generated temporary snapshot',
    )
    const valid = await snapshot()
    const hardlink = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
    await link(valid, hardlink)
    paths.add(hardlink)
    await expect(partitionSnapshot({ path: hardlink })).rejects.toThrow(
      'unlinked generated regular file',
    )
    await rm(hardlink)
    paths.delete(hardlink)
    const symlinked = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
    await symlink(valid, symlinked)
    paths.add(symlinked)
    await expect(partitionSnapshot({ path: symlinked })).rejects.toThrow(
      'unlinked generated regular file',
    )
    await rm(symlinked)
    paths.delete(symlinked)
    const malformed = await snapshot([{ type: 'entry', entry: { sessionId: 'one' } }])
    await expect(partitionSnapshot({ path: malformed })).rejects.toThrow('unsupported record')
    await expect(
      partitionSnapshot({ path: valid, checksum: { algorithm: 'sha256', value: 'wrong' } }),
    ).rejects.toThrow('checksum')
    await expect(partitionSnapshot({ path: valid, maxSessions: 0 })).rejects.toThrow('maxSessions')
    await expect(partitionSnapshot({ path: valid, maxBytes: 1 })).rejects.toThrow('too large')
  })

  it('enforces ordering, complete terminal counts, blank records, and no records after manifest', async () => {
    const records = sourceRecords() as Array<Record<string, unknown>>
    const invalids: Array<[unknown[], string]> = [
      [
        [
          {
            type: 'entry',
            entry: { sessionId: 'one', createdAt: '2026-01-01T00:00:00.000Z', data: {} },
          },
        ],
        'entries must follow',
      ],
      [records.slice(0, -1), 'complete terminal'],
      [[...records, { type: 'session', session: {} }], 'after its manifest'],
      [
        [
          {
            type: 'manifest',
            manifest: {
              ...(records.at(-1)!.manifest as Record<string, unknown>),
              counts: { sessions: 1, entries: 2, records: 5 },
            },
          },
        ],
        'counts do not match',
      ],
    ]
    for (const [input, message] of invalids)
      await expect(partitionSnapshot({ path: await snapshot(input) })).rejects.toThrow(message)
    const blank = await snapshot([])
    await chmod(blank, 0o600)
    await writeFile(blank, '\n', { mode: 0o400 })
    await expect(partitionSnapshot({ path: blank })).rejects.toThrow('blank JSONL')
    const unordered = structuredClone(records)
    ;(unordered[2]!.session as Record<string, unknown>).createdAt = '2025-01-01T00:00:00.000Z'
    await expect(partitionSnapshot({ path: await snapshot(unordered) })).rejects.toThrow(
      'sessions are not ordered',
    )
    const offsetUnordered = structuredClone(records)
    ;(offsetUnordered[0]!.session as Record<string, unknown>).createdAt =
      '2026-01-01T00:00:00+01:00'
    ;(offsetUnordered[1]!.entry as Record<string, unknown>).createdAt = '2026-01-01T00:00:00+01:00'
    ;(offsetUnordered[2]!.session as Record<string, unknown>).createdAt = '2025-12-31T22:30:00.000Z'
    await expect(partitionSnapshot({ path: await snapshot(offsetUnordered) })).rejects.toThrow(
      'sessions are not ordered',
    )
  })

  it('detects post-EOF growth and removes both staging and output directories after failure', async () => {
    const path = await snapshot()
    await chmod(path, 0o600)
    const restore = await appendAfterSourceEof(path)
    try {
      await expect(partitionSnapshot({ path })).rejects.toThrow('changed while it was being read')
    } finally {
      restore()
    }
    const late = await snapshot()
    await expect(partitionSnapshot({ path: late, maxBytes: 1 })).rejects.toThrow('too large')
  })

  it('streams many session blocks and attempts every cleanup target with aggregate failures', async () => {
    const sessions = Array.from({ length: 130 }, (_, index) => ({
      type: 'session',
      session: {
        id: `stream-${index}`,
        parentSessionId: null,
        agent: 'agent',
        version: '1',
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        lastEntryAt: null,
        archivedAt: null,
        data: { index },
      },
    }))
    const terminal = (sourceRecords().at(-1) as { manifest: Record<string, unknown> }).manifest
    const path = await snapshot([
      ...sessions,
      {
        type: 'manifest',
        manifest: {
          ...terminal,
          counts: { sessions: sessions.length, entries: 0, records: sessions.length + 1 },
        },
      },
    ])
    const result = await partitionSnapshot({ path, maxSessions: 25 })
    paths.add(result.directory)
    expect(result.partitions).toHaveLength(6)
    const unsafe = join(tmpdir(), `agent-blackboard-partitions-${randomUUID().replaceAll('-', '')}`)
    await writeFile(unsafe, 'not a directory')
    paths.add(unsafe)
    await expect(cleanupSnapshotPartitions({ path, directory: unsafe })).rejects.toThrow(
      'requires a receipt',
    )
    await expect(readFile(path)).resolves.toBeTruthy()
    await expect(readFile(unsafe, 'utf8')).resolves.toBe('not a directory')
  })

  it('refuses caller-created partition-prefixed directories with unexpected contents', async () => {
    const prefix = join(tmpdir(), `agent-blackboard-partitions-${randomUUID().replaceAll('-', '')}`)
    const directory = await mkdtemp(prefix)
    paths.add(directory)
    await writeFile(join(directory, 'caller-data'), 'keep')
    await expect(cleanupSnapshotPartitions({ directory })).rejects.toThrow('requires a receipt')
    await expect(readFile(join(directory, 'caller-data'), 'utf8')).resolves.toBe('keep')
  })
})
