import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  composeRetrospective,
  type JournalEntry,
  type JournalLoader,
  type RetrospectiveCompositionInput,
} from '../agent-blackboard/index.mts'
import { validateRetrospectiveMarkdown } from './retrospective-validate.mts'

const ci = [
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

let directory: string
let transcript: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'retrospective-validate-compose-'))
  transcript = join(directory, 'transcript.jsonl')
  await writeFile(
    transcript,
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }) + '\n',
  )
})
afterAll(() => rm(directory, { recursive: true, force: true }))

const at = (day: number) => `2026-01-0${day}T00:00:00.000Z`
const journal = (day: number, markdown: string): JournalEntry => ({
  createdAt: at(day),
  data: { type: 'journal', markdown },
})
const retrospective = (day: number): JournalEntry => ({
  createdAt: at(day),
  data: { type: 'retrospective', sourceEventId: 'r1' },
})
const loader =
  (...entries: JournalEntry[]): JournalLoader =>
  () => ({ status: 'ok', entries })

const base = (): RetrospectiveCompositionInput => ({
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

async function passes(input: RetrospectiveCompositionInput): Promise<string> {
  const markdown = await composeRetrospective(input)
  expect(validateRetrospectiveMarkdown(markdown, input.feedbackCoverage.status)).toEqual([])
  return markdown
}

describe('composeRetrospective output passes the built-in validator', () => {
  it('with every source unavailable or not assessed', async () => {
    const markdown = await passes(base())
    expect(markdown).toContain('Status: unavailable (not assessed)')
  })

  it('with a journal that has failures, sandbox events and an earlier retrospective', async () => {
    const markdown = await passes({
      ...base(),
      journal: {
        journalLoader: loader(
          journal(1, ci),
          journal(4, ci),
          journal(5, escalation),
          retrospective(3),
        ),
      },
    })
    expect(markdown).toContain('Status: failures observed\nExcluded: 1 blocks')
  })

  it('with no CI failure left after an earlier retrospective', async () => {
    const markdown = await passes({
      ...base(),
      journal: { journalLoader: loader(journal(1, ci), journal(4, escalation), retrospective(3)) },
    })
    expect(markdown).toContain('Status: none observed\nExcluded: 1 blocks')
  })

  it('with a truncated journal scan that still lists failure groups', async () => {
    const markdown = await passes({
      ...base(),
      journal: {
        journalLoader: loader(journal(4, ci), journal(5, 'x'.repeat(10_001)), retrospective(3)),
      },
    })
    expect(markdown).toContain('Status: unavailable (journal scan incomplete)')
    expect(markdown).toContain('lint job timed out')
  })

  it('with unreachable and missing journals', async () => {
    const unreachable = () => {
      throw new Error('blackboard down')
    }
    await passes({ ...base(), journal: { journalLoader: unreachable } })
    await passes({ ...base(), journal: { journalLoader: () => ({ status: 'not-found' }) } })
  })

  it('with tool and architecture findings including a tracking reference', async () => {
    const finding = {
      observation: 'Hook was slow',
      evidence: 'run took 12s',
      disposition: 'filed',
      trackingReference: 'owner/repo#4',
    }
    const markdown = await passes({
      ...base(),
      tools: { status: 'findings', findings: [finding] },
      architecture: { status: 'findings', findings: [finding, finding], reason: 'read modules' },
    })
    expect(markdown).toContain('  - Tracking: owner/repo#4')
  })

  it('with every source assessed and complete coverage', async () => {
    const markdown = await passes({
      ...base(),
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
      journal: { journalLoader: loader() },
    })
    expect(markdown).toContain('=== Transcript Facts ===')
  })
})
