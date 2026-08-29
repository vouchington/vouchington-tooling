import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assertManifest,
  consumeSnapshotRecord,
  countsFor,
  manifestFor,
  parseSnapshotRecord,
  snapshotLine,
} from './snapshot-partition-format.mts'
import { readLines, writeAll } from './snapshot-partition-io.mts'
import { assertPartitionFile } from './snapshot-partition-validate.mts'

const timestamp = '2026-01-01T00:00:00.000Z'
const session = {
  id: 'session:one',
  parentSessionId: null,
  agent: 'codex',
  version: '1',
  createdAt: timestamp,
  lastEntryAt: null,
  archivedAt: null,
  data: {},
}
const entry = { sessionId: session.id, createdAt: timestamp, data: {} }
const manifest = {
  schemaVersion: 1 as const,
  status: 'complete' as const,
  createdAt: timestamp,
  completedAt: timestamp,
  selection: { archived: false as const },
  counts: { sessions: 1, entries: 1, records: 3 },
  ordering: {
    sessions: 'createdAt ascending' as const,
    entries: 'createdAt ascending within session' as const,
  },
  consistency: 'best-effort' as const,
}

function state() {
  return { sessions: 0, entries: 0, records: 0 }
}

describe('snapshot record format', () => {
  it('parses records, tracks their state, and creates terminal manifests', () => {
    const snapshotState = state()
    const parsedSession = parseSnapshotRecord(JSON.stringify({ type: 'session', session }))
    const parsedEntry = parseSnapshotRecord(JSON.stringify({ type: 'entry', entry }))
    const parsedManifest = parseSnapshotRecord(JSON.stringify({ type: 'manifest', manifest }))
    if (parsedManifest.type !== 'manifest') throw new Error('expected manifest')
    consumeSnapshotRecord(parsedSession, snapshotState)
    consumeSnapshotRecord(parsedEntry, snapshotState)
    consumeSnapshotRecord(parsedManifest, snapshotState)
    expect(snapshotState).toEqual({
      sessions: 1,
      entries: 1,
      records: 2,
      lastSessionCreatedAt: Date.parse(timestamp),
      lastEntryCreatedAt: Date.parse(timestamp),
      currentSessionId: session.id,
    })
    expect(snapshotLine(parsedManifest)).toBe(`${JSON.stringify(parsedManifest)}\n`)
    expect(countsFor({ sessions: 1, entries: 1 }, 42)).toEqual({
      sessions: 1,
      entries: 1,
      records: 3,
      bytes: 42,
    })
    expect(manifestFor(manifest, { sessions: 1, entries: 1 }).counts).toEqual(manifest.counts)
    expect(() => assertManifest(parsedManifest.manifest, snapshotState)).not.toThrow()
  })

  it.each([
    ['invalid JSONL', '{'],
    ['invalid record', 'null'],
    ['unsupported record', JSON.stringify({ type: 'unknown' })],
    [
      'unsupported record',
      JSON.stringify({ type: 'session', session: { ...session, id: '../bad' } }),
    ],
    [
      'unsupported record',
      JSON.stringify({ type: 'entry', entry: { ...entry, sessionId: 'bad/path' } }),
    ],
  ])('rejects %s', (_label, input) => {
    expect(() => parseSnapshotRecord(input)).toThrow(_label)
  })

  it('rejects invalid manifests and record order', () => {
    const snapshotState = state()
    expect(() =>
      assertManifest({ ...manifest, status: 'partial' } as never, snapshotState),
    ).toThrow('complete terminal')
    const parsedSession = parseSnapshotRecord(JSON.stringify({ type: 'session', session }))
    const laterSession = parseSnapshotRecord(
      JSON.stringify({
        type: 'session',
        session: { ...session, id: 'session:two', createdAt: '2025-01-01T00:00:00.000Z' },
      }),
    )
    consumeSnapshotRecord(parsedSession, snapshotState)
    expect(() => consumeSnapshotRecord(laterSession, snapshotState)).toThrow('not ordered')
    expect(() =>
      consumeSnapshotRecord(parseSnapshotRecord(JSON.stringify({ type: 'entry', entry })), state()),
    ).toThrow('entries must follow')
    const ordered = state()
    consumeSnapshotRecord(parsedSession, ordered)
    consumeSnapshotRecord(parseSnapshotRecord(JSON.stringify({ type: 'entry', entry })), ordered)
    expect(() =>
      assertManifest({ ...manifest, counts: { sessions: 0, entries: 1, records: 3 } }, ordered),
    ).toThrow('counts do not match')
    const entryState = state()
    consumeSnapshotRecord(parsedSession, entryState)
    consumeSnapshotRecord(parseSnapshotRecord(JSON.stringify({ type: 'entry', entry })), entryState)
    expect(() =>
      consumeSnapshotRecord(
        parseSnapshotRecord(
          JSON.stringify({
            type: 'entry',
            entry: { ...entry, createdAt: '2025-01-01T00:00:00.000Z' },
          }),
        ),
        entryState,
      ),
    ).toThrow('entries are not ordered')
  })

  it.each([
    [{ ...manifest, createdAt: 'not-a-date' }],
    [{ ...manifest, selection: { archived: true } }],
    [{ ...manifest, selection: { archived: false, agent: 1 } }],
    [{ ...manifest, selection: { archived: false, parentSessionId: 1 } }],
    [{ ...manifest, selection: { archived: false, inactiveForHours: 0 } }],
    [{ ...manifest, selection: { archived: false, version: 1 } }],
    [{ ...manifest, selection: { archived: false, data: 1 } }],
    [{ ...manifest, counts: { sessions: -1, entries: 1, records: 1 } }],
  ])('rejects malformed complete manifests', (invalidManifest) => {
    expect(() => assertManifest(invalidManifest as never, state())).toThrow('complete terminal')
  })

  it('accepts safe parents and rejects incomplete session records', () => {
    expect(() =>
      parseSnapshotRecord(
        JSON.stringify({ type: 'session', session: { ...session, parentSessionId: 'parent:one' } }),
      ),
    ).not.toThrow()
    expect(() =>
      parseSnapshotRecord(
        JSON.stringify({ type: 'session', session: { ...session, lastEntryAt: timestamp } }),
      ),
    ).not.toThrow()
    expect(() =>
      parseSnapshotRecord(JSON.stringify({ type: 'session', session: { ...session, agent: 1 } })),
    ).toThrow('unsupported record')
  })
})

describe('snapshot partition IO', () => {
  it('writes partial writes until complete and rejects zero-progress writes', async () => {
    const writes: Uint8Array[] = []
    await writeAll(
      {
        write: async (bytes: Uint8Array, offset: number) => {
          writes.push(bytes.subarray(offset, offset + 1))
          return { bytesWritten: 1 }
        },
      } as never,
      Buffer.from('abc'),
    )
    expect(Buffer.concat(writes).toString()).toBe('abc')
    await expect(
      writeAll({ write: async () => ({ bytesWritten: 0 }) } as never, Buffer.from('x')),
    ).rejects.toThrow('could not write')
  })

  it('decodes split and unterminated UTF-8 JSONL lines and feeds hash and byte observers', async () => {
    const chunks = [Buffer.from('first\nse'), Buffer.from('cond\nlast')]
    let cursor = 0
    const bytes: number[] = []
    const hash = createHash('sha256')
    const lines: string[] = []
    for await (const line of readLines(
      {
        read: async (buffer: Uint8Array) => {
          const chunk = chunks[cursor++] ?? Buffer.alloc(0)
          buffer.set(chunk)
          return { bytesRead: chunk.byteLength }
        },
      } as never,
      hash,
      (read) => bytes.push(read),
    ))
      lines.push(line)
    expect(lines).toEqual(['first', 'second', 'last'])
    expect(bytes).toEqual([8, 9])
    expect(hash.digest('hex')).toBe(
      createHash('sha256').update(Buffer.concat(chunks)).digest('hex'),
    )
  })

  it('rejects unsafe partition stats', () => {
    for (const info of [
      { isFile: () => false, isSymbolicLink: () => false, nlink: 1, mode: 0o400 },
      { isFile: () => true, isSymbolicLink: () => true, nlink: 1, mode: 0o400 },
      { isFile: () => true, isSymbolicLink: () => false, nlink: 2, mode: 0o400 },
      { isFile: () => true, isSymbolicLink: () => false, nlink: 1, mode: 0o600 },
    ])
      expect(() => assertPartitionFile(info as never)).toThrow('unsafe partition')
  })
})
