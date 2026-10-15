import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { readPartitionRecords } from './partition-records.mts'

const testDirs: string[] = []

async function writeRawPartition(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'distill-partition-'))
  testDirs.push(dir)
  const path = join(dir, 'partition.jsonl')
  await writeFile(path, content, 'utf8')
  return path
}

async function makePartition(lines: unknown[]): Promise<string> {
  return writeRawPartition(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
}

describe('readPartitionRecords', () => {
  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('groups entries under their session and ignores the manifest line', async () => {
    const path = await makePartition([
      { type: 'session', session: { id: 's1', agent: 'claude', version: '1' } },
      {
        type: 'entry',
        entry: { sessionId: 's1', createdAt: '2026-07-20T00:00:00.000Z', data: {} },
      },
      {
        type: 'entry',
        entry: { sessionId: 's1', createdAt: '2026-07-21T00:00:00.000Z', data: {} },
      },
      { type: 'manifest', manifest: { schemaVersion: 1, status: 'complete' } },
    ])

    const { entriesBySession, sessions } = await readPartitionRecords(path)

    expect(sessions).toEqual([{ id: 's1', agent: 'claude', version: '1' }])
    expect(entriesBySession.get('s1')).toHaveLength(2)
  })

  it('returns an empty result for an empty partition', async () => {
    const path = await makePartition([])
    const { entriesBySession, sessions } = await readPartitionRecords(path)
    expect(sessions).toEqual([])
    expect(entriesBySession.size).toBe(0)
  })

  it('skips an unrecognized record type rather than failing', async () => {
    const path = await makePartition([
      { type: 'error', error: { code: 'boom' } },
      { type: 'session', session: { id: 's1', agent: 'claude', version: '1' } },
    ])
    const { sessions } = await readPartitionRecords(path)
    expect(sessions).toEqual([{ id: 's1', agent: 'claude', version: '1' }])
  })

  it('throws on a line that is not valid JSON', async () => {
    const path = await writeRawPartition('not json\n')
    await expect(readPartitionRecords(path)).rejects.toThrow('not valid JSON')
  })

  it('throws on a record with no string type field', async () => {
    const path = await makePartition([{ session: { id: 's1' } }])
    await expect(readPartitionRecords(path)).rejects.toThrow('no string "type" field')
  })
})
