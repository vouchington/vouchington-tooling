import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retrospectiveBoundary } from '../audit-journal/scope.mts'
import {
  composeRetrospective,
  type JournalEntry,
  type JournalLoader,
  type RetrospectiveCompositionInput,
} from './index.mts'

const at = (day: number): string => `2026-01-0${day}T00:00:00.000Z`
const prompt = (day: number): string =>
  JSON.stringify({
    timestamp: at(day),
    type: 'event_msg',
    payload: { type: 'user_message' },
  })
const note = (day: number): JournalEntry => ({
  createdAt: at(day),
  data: { type: 'journal', markdown: 'a note' },
})
const retro = (sourceEventId: string, day: number): JournalEntry => ({
  createdAt: at(day),
  data: { type: 'retrospective', sourceEventId },
})
const loader =
  (...entries: JournalEntry[]): JournalLoader =>
  () => ({ status: 'ok', entries })

let directory: string
let transcript: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'feedback-compose-window-'))
  transcript = join(directory, 'transcript.jsonl')
  await writeFile(transcript, [prompt(1), prompt(2), prompt(4), prompt(5)].join('\n'))
})
afterAll(() => rm(directory, { recursive: true, force: true }))

const compose = (
  journalLoader: JournalLoader,
  window: { since?: string; until?: string } = {},
): Promise<string> =>
  composeRetrospective({
    sessionId: 'native:owner',
    date: '2026-01-06',
    issues: [1],
    prs: [],
    description: 'Completed bounded task',
    repositories: ['owner/repo'],
    workOutcome: 'success',
    feedbackCoverage: { status: 'partial', sources: ['transcript', 'journal'], droppedCount: 0 },
    narrative: 'Narrative.',
    facts: { status: 'unavailable', reason: 'repository not assessed' },
    transcript: { jsonlPath: transcript, ...window },
    journal: { journalLoader },
    tools: { status: 'none-observed', reason: 'inspected tool results' },
    architecture: { status: 'none-observed', reason: 'inspected changed service' },
  } satisfies RetrospectiveCompositionInput)

describe('transcript window default', () => {
  it('counts only events after the newest earlier retrospective', async () => {
    const markdown = await compose(loader(note(1), retro('r1', 3), note(5)))
    expect(markdown).toContain(
      `Window: after ${at(3)} (retrospective r1)\nExcluded: 2 events outside the window`,
    )
    expect(markdown).toContain('User prompts: 2\n')
  })

  it('reports the whole thread when no retrospective precedes the journal', async () => {
    for (const entries of [[note(1), note(5)], [retro('r1', 6), note(5)], []]) {
      const markdown = await compose(loader(...entries))
      expect(markdown).not.toContain('Window:')
      expect(markdown).toContain('User prompts: 4\n')
    }
  })

  it('reports the whole thread when the journal is unavailable', async () => {
    const markdown = await compose(() => ({ status: 'not-found' }))
    expect(markdown).not.toContain('Window:')
    expect(markdown).toContain('User prompts: 4\n')
  })

  it('lets an explicit bound replace the default', async () => {
    const entries = loader(note(1), retro('r1', 3), note(5))
    const since = await compose(entries, { since: at(1) })
    expect(since).toContain(`Window: after ${at(1)}\nExcluded: 1 events outside the window`)
    const until = await compose(entries, { until: at(2) })
    expect(until).toContain(`Window: until ${at(2)}\nExcluded: 2 events outside the window`)
  })
})

describe('retrospectiveBoundary', () => {
  it('is the newest retrospective older than the newest journal entry', () => {
    const retros = [
      { sourceEventId: 'r1', createdAt: at(2) },
      { sourceEventId: 'r2', createdAt: at(4) },
      { sourceEventId: 'r3', createdAt: at(6) },
    ]
    expect(retrospectiveBoundary([note(1), note(5)], retros)?.sourceEventId).toBe('r2')
    expect(retrospectiveBoundary([note(3)], retros)?.sourceEventId).toBe('r1')
    expect(retrospectiveBoundary([note(1)], retros)).toBeUndefined()
    expect(retrospectiveBoundary([{ data: { type: 'journal', markdown: 'x' } }], retros)).toBe(
      undefined,
    )
  })
})
