import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordFriction } from '../session-friction/index.mts'
import {
  composeRetrospective,
  type JournalEntry,
  type JournalLoader,
  type RetrospectiveCompositionInput,
} from './index.mts'

const ciFailure = [
  '- `one-off` — `GitHub Actions` — lint job timed out',
  '  - Evidence: run 42 exceeded 10 minutes',
  '  - Root diagnostic: runner starvation',
  '  - Disposition: reran, passed',
].join('\n')
const escalation = [
  '- `sandbox-escalation` — git push — network write blocked',
  '  - Outcome: approved',
  '  - Evidence: permission prompt shown',
  '  - Disposition: reran with approval',
].join('\n')
const COMPLETE_ERROR = /complete feedback coverage requires assessed available/

let directory: string
let transcript: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'feedback-compose-journal-'))
  transcript = join(directory, 'transcript.jsonl')
  await writeFile(
    transcript,
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }) + '\n',
  )
})
afterAll(() => rm(directory, { recursive: true, force: true }))

const entries = (...markdown: string[]): JournalEntry[] =>
  markdown.map((value) => ({ data: { type: 'journal', markdown: value } }))
const loader =
  (...markdown: string[]): JournalLoader =>
  () => ({ status: 'ok', entries: entries(...markdown) })
const partial = (): RetrospectiveCompositionInput => ({
  sessionId: 'native:owner',
  date: '2026-01-01',
  issues: [1],
  prs: [],
  description: 'Completed bounded task',
  repositories: ['owner/repo'],
  workOutcome: 'success',
  feedbackCoverage: { status: 'partial', sources: ['journal'], droppedCount: 0 },
  narrative: 'Useful resolved finding retained.',
  facts: { status: 'unavailable', reason: 'repository not assessed' },
  transcript: { status: 'not-assessed', reason: 'no transcript selected' },
  tools: { status: 'none-observed', reason: 'inspected tool results' },
  architecture: { status: 'none-observed', reason: 'inspected changed service' },
})
const assessed = (): RetrospectiveCompositionInput => ({
  ...partial(),
  facts: {
    repo: 'owner/repo',
    pr: '1',
    execute: async () => ({
      ok: true,
      stdout: JSON.stringify({
        number: 1,
        state: 'OPEN',
        headRefName: 'feature',
        baseRefName: 'main',
        changedFiles: 0,
        files: [],
        commits: [],
      }),
      stderr: '',
    }),
  },
  transcript: { jsonlPath: transcript },
  feedbackCoverage: {
    status: 'complete',
    sources: ['repository', 'transcript', 'journal'],
    droppedCount: 0,
  },
})

describe('journal-only composition', () => {
  it('reaches complete coverage from journal entries with no friction log', async () => {
    const markdown = await composeRetrospective({
      ...assessed(),
      journal: { journalLoader: loader() },
    })
    expect(markdown).toContain('feedback_coverage: {"status":"complete"')
    expect(markdown).toContain('Feedback coverage: complete')
    expect(markdown).toContain('## CI Failures\nStatus: none observed\n\n')
    expect(markdown).toContain(
      '## Sandbox & Permission Audit\nStatus: none observed (journal entries only; no friction log observed)',
    )
    expect(markdown).not.toContain('not assessed')
  })

  it('renders CI failure and sandbox or permission entries from the journal', async () => {
    const markdown = await composeRetrospective({
      ...assessed(),
      journal: { journalLoader: loader(ciFailure, escalation) },
    })
    expect(markdown).toContain(`\n\n## CI Failures\nStatus: failures observed\n\n${ciFailure}\n\n`)
    expect(markdown).toContain(
      `\n\n## Sandbox & Permission Audit\nStatus: events observed (journal entries only; no friction log observed)\n\n${escalation}\n\n`,
    )
    expect(markdown.indexOf('## Transcript Facts')).toBeLessThan(markdown.indexOf('## CI Failures'))
    expect(markdown.indexOf('## Sandbox & Permission Audit')).toBeLessThan(
      markdown.indexOf('## Tool Findings'),
    )
  })

  it('renders a journal audit under partial coverage without collectors', async () => {
    const markdown = await composeRetrospective({
      ...partial(),
      journal: { journalLoader: loader(escalation) },
    })
    expect(markdown).toContain('Feedback coverage: partial')
    expect(markdown).toContain(escalation)
  })

  it('does not reach complete coverage when the journal is missing, unreachable or truncated', async () => {
    const loaders: JournalLoader[] = [
      () => ({ status: 'not-found' }),
      () => {
        throw new Error('offline')
      },
      () => ({
        status: 'ok',
        entries: (function* () {
          while (true) yield { data: { type: 'retrospective' } } as JournalEntry
        })(),
      }),
    ]
    for (const journalLoader of loaders) {
      await expect(
        composeRetrospective({ ...assessed(), journal: { journalLoader } }),
      ).rejects.toThrow(COMPLETE_ERROR)
      const markdown = await composeRetrospective({ ...partial(), journal: { journalLoader } })
      expect(markdown).toContain('Feedback coverage: partial')
      expect(markdown).toMatch(/## CI Failures\nStatus: unavailable \(/)
      expect(markdown).toMatch(/## Sandbox & Permission Audit\nStatus: unavailable \(/)
    }
  })

  it('still requires every other complete-coverage source', async () => {
    const journal = { journalLoader: loader() }
    const other = [
      { facts: partial().facts },
      { transcript: partial().transcript },
      { tools: { status: 'not-assessed' as const, reason: 'skipped' } },
      { architecture: { status: 'unavailable' as const, reason: 'skipped' } },
    ]
    for (const override of other)
      await expect(composeRetrospective({ ...assessed(), ...override, journal })).rejects.toThrow(
        COMPLETE_ERROR,
      )
  })
})

describe('audit source selection', () => {
  it('rejects supplying both a friction and a journal source before running collectors', async () => {
    let calls = 0
    const current = assessed()
    await expect(
      composeRetrospective({
        ...current,
        facts: {
          repo: 'owner/repo',
          pr: '1',
          execute: async () => {
            calls++
            return { ok: false, stdout: '', stderr: '' }
          },
        },
        friction: { directory, journalLoader: loader() },
        journal: { journalLoader: loader() },
      }),
    ).rejects.toThrow('either a friction or a journal audit source, not both')
    expect(calls).toBe(0)
  })

  it('names the missing source when complete coverage is requested with neither', async () => {
    await expect(composeRetrospective(assessed())).rejects.toThrow(COMPLETE_ERROR)
    await expect(composeRetrospective(assessed())).rejects.toThrow(
      /no friction or journal source supplied for CI failures and sandbox audit/,
    )
  })

  it('keeps the not-assessed sections for partial coverage with neither source', async () => {
    const markdown = await composeRetrospective(partial())
    expect(markdown).toContain(
      '## CI Failures\nStatus: unavailable (not assessed)\n\n## Sandbox & Permission Audit\nStatus: unavailable (not assessed)',
    )
  })

  it('leaves the friction input behaviour unchanged', async () => {
    const options = { directory }
    recordFriction('native:owner', { type: 'permission-request', command: 'git push' }, options)
    const friction = { ...options, journalLoader: loader(ciFailure) }
    const markdown = await composeRetrospective({ ...assessed(), friction })
    expect(markdown).toContain('feedback_coverage: {"status":"complete"')
    expect(markdown).toContain(`## CI Failures\nStatus: failures observed\n\n${ciFailure}`)
    expect(markdown).toContain('## Sandbox & Permission Audit\nEvents observed: 1')
    expect(markdown).not.toContain('journal entries only')
    await expect(
      composeRetrospective({
        ...assessed(),
        friction: { directory: join(directory, 'missing'), journalLoader: loader() },
      }),
    ).rejects.toThrow(COMPLETE_ERROR)
  })
})
