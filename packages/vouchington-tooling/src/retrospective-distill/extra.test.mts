import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFeedbackEnvelope } from '../agent-blackboard/index.mts'
import { parseDistillClassifyArgs } from './args.mts'
import { entryFixture, sessionFixture } from './fixtures.test-helpers.mts'
import { parseStringFlags } from './flag-args.mts'
import * as distill from './index.mts'
import { isRetrospectiveEntry } from './retrospective-entry.mts'

const dirs: string[] = []

describe('isRetrospectiveEntry', () => {
  it('matches only entries typed retrospective', () => {
    expect(isRetrospectiveEntry(entryFixture({ data: { type: 'retrospective' } }))).toBe(true)
    expect(isRetrospectiveEntry(entryFixture({ data: { type: 'journal' } }))).toBe(false)
    expect(isRetrospectiveEntry(entryFixture())).toBe(false)
  })
})

describe('parseStringFlags', () => {
  const flags = ['--a', '--b']

  it('collects values and positionals', () => {
    const { values, positional } = parseStringFlags(['x', '--a', '-v', 'y'], flags)
    expect(Object.fromEntries(values)).toEqual({ '--a': '-v' })
    expect(positional).toEqual(['x', 'y'])
  })

  it('treats everything after -- as positional', () => {
    const { values, positional } = parseStringFlags(['--', '--a', '-x'], flags)
    expect(values.size).toBe(0)
    expect(positional).toEqual(['--a', '-x'])
  })

  it.each([
    [['--a'], '--a requires a value'],
    [['--a', '--'], '--a requires a value'],
    [['--a', '--b', 'v'], '--a requires a value'],
    [['--a', '1', '--a', '2'], '--a may only be specified once'],
    [['-z'], 'unknown option: -z'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseStringFlags(argv, flags)).toThrow(message)
  })
})

describe('parseDistillClassifyArgs', () => {
  it('rejects a cutoff given without a valid timestamp for the session cutoff', () => {
    expect(() =>
      parseDistillClassifyArgs([
        'p.jsonl',
        '--retro-cutoff',
        '2026-08-01',
        '--session-cutoff',
        'x',
      ]),
    ).toThrow('--session-cutoff must be a valid ISO 8601 timestamp')
  })
})

describe('runDistillClassify duplicate reporting', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('appends the duplicate-event count when a source event is replayed', async () => {
    const stale = '2026-07-01T00:00:00.000Z'
    const data = createFeedbackEnvelope({
      schemaVersion: 1,
      type: 'journal',
      sourceEventId: 'note',
      timestamp: stale,
      markdown: 'one observation',
      repositories: ['example/repo'],
      workOutcome: 'in-progress',
      feedbackCoverage: { status: 'partial', sources: ['journal'], droppedCount: 0 },
    })
    const dir = await mkdtemp(join(tmpdir(), 'distill-extra-'))
    dirs.push(dir)
    const path = join(dir, 'partition.jsonl')
    const lines = [
      { type: 'session', session: sessionFixture({ id: 's1', createdAt: stale }) },
      { type: 'entry', entry: entryFixture({ sessionId: 's1', createdAt: stale, data }) },
      { type: 'entry', entry: entryFixture({ sessionId: 's1', createdAt: stale, data }) },
    ]
    await writeFile(path, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8')
    const output = await distill.runDistillClassify([
      path,
      '--retro-cutoff',
      '2026-08-01T00:00:00.000Z',
      '--session-cutoff',
      '2026-08-15T00:00:00.000Z',
    ])
    expect(output).toBe('s1\tjournal-only\teligible\tduplicate-events=1')
  })
})

describe('classifySession newest retrospective', () => {
  it('keeps the newest retrospective when an older one is listed after it', () => {
    const fresh = '2026-08-20T00:00:00.000Z'
    const stale = '2026-07-01T00:00:00.000Z'
    const session = sessionFixture({ id: 's1', createdAt: stale, lastEntryAt: fresh })
    const entries = [
      entryFixture({ sessionId: 's1', createdAt: fresh, data: { type: 'retrospective' } }),
      entryFixture({ sessionId: 's1', createdAt: stale, data: { type: 'retrospective' } }),
    ]
    const cutoffs = { retroCutoff: '2026-08-01T00:00:00.000Z', sessionCutoff: stale }
    expect(distill.classifySession(session, entries, cutoffs).eligible).toBe(false)
  })
})

describe('public surface', () => {
  it('exports the classifier, parsers, and runner', () => {
    expect(Object.keys(distill).toSorted()).toEqual([
      'classifySession',
      'isCheckpointEntry',
      'isRetrospectiveEntry',
      'parseDistillClassifyArgs',
      'readPartitionRecords',
      'runDistillClassify',
    ])
  })
})
