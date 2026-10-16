import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runDistillClassify } from './run.mts'

const testDirs: string[] = []

async function makePartition(lines: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'distill-run-'))
  testDirs.push(dir)
  const path = join(dir, 'partition.jsonl')
  await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
  return path
}

const RETRO_CUTOFF = '2026-08-01T00:00:00.000Z'
const SESSION_CUTOFF = '2026-08-15T00:00:00.000Z'
const STALE = '2026-07-01T00:00:00.000Z'

describe('runDistillClassify', () => {
  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('prints "<id>\\t<shape>\\t<eligibility>" for every shape in one partition', async () => {
    const path = await makePartition([
      // retrospective, stale -> eligible
      {
        type: 'session',
        session: {
          id: 'retro',
          agent: 'claude',
          version: '1',
          parentSessionId: null,
          createdAt: STALE,
          lastEntryAt: STALE,
          archivedAt: null,
          data: {},
        },
      },
      {
        type: 'entry',
        entry: { sessionId: 'retro', createdAt: STALE, data: { type: 'retrospective' } },
      },
      // checkpoint-only, fresh -> not-yet-eligible
      {
        type: 'session',
        session: {
          id: 'checkpoint',
          agent: 'claude',
          version: '1',
          parentSessionId: null,
          createdAt: SESSION_CUTOFF,
          lastEntryAt: SESSION_CUTOFF,
          archivedAt: null,
          data: {},
        },
      },
      {
        type: 'entry',
        entry: {
          sessionId: 'checkpoint',
          createdAt: SESSION_CUTOFF,
          data: { type: 'journal', checkpoint: 'compaction' },
        },
      },
      // journal-only, stale -> eligible
      {
        type: 'session',
        session: {
          id: 'journal',
          agent: 'claude',
          version: '1',
          parentSessionId: null,
          createdAt: STALE,
          lastEntryAt: STALE,
          archivedAt: null,
          data: {},
        },
      },
      {
        type: 'entry',
        entry: { sessionId: 'journal', createdAt: STALE, data: { type: 'journal' } },
      },
      // entry-type-unresolved, stale -> never eligible
      {
        type: 'session',
        session: {
          id: 'unresolved',
          agent: 'claude',
          version: '1',
          parentSessionId: null,
          createdAt: STALE,
          lastEntryAt: STALE,
          archivedAt: null,
          data: {},
        },
      },
      {
        type: 'entry',
        entry: { sessionId: 'unresolved', createdAt: STALE, data: { type: 'note' } },
      },
      // zero-entry-child, stale -> eligible
      {
        type: 'session',
        session: {
          id: 'child',
          agent: 'claude',
          version: '1',
          parentSessionId: 'retro',
          createdAt: STALE,
          lastEntryAt: null,
          archivedAt: null,
          data: {},
        },
      },
      // zero-entry-root, fresh -> not-yet-eligible
      {
        type: 'session',
        session: {
          id: 'root',
          agent: 'claude',
          version: '1',
          parentSessionId: null,
          createdAt: SESSION_CUTOFF,
          lastEntryAt: null,
          archivedAt: null,
          data: {},
        },
      },
      { type: 'manifest', manifest: { schemaVersion: 1, status: 'complete' } },
    ])

    const output = await runDistillClassify([
      path,
      '--retro-cutoff',
      RETRO_CUTOFF,
      '--session-cutoff',
      SESSION_CUTOFF,
    ])

    expect(output.split('\n')).toEqual([
      'retro\tretrospective\teligible',
      'checkpoint\tcheckpoint-only\tnot-yet-eligible',
      'journal\tjournal-only\teligible',
      'unresolved\tentry-type-unresolved\tnot-yet-eligible\tquarantined=1;reasons=unknown-entry-type',
      'child\tzero-entry-child\teligible',
      'root\tzero-entry-root\tnot-yet-eligible',
    ])
  })

  it('reports when the partition holds no sessions', async () => {
    const path = await makePartition([
      { type: 'manifest', manifest: { schemaVersion: 1, status: 'complete' } },
    ])
    const output = await runDistillClassify([
      path,
      '--retro-cutoff',
      RETRO_CUTOFF,
      '--session-cutoff',
      SESSION_CUTOFF,
    ])
    expect(output).toBe('No sessions found in partition.')
  })
})
