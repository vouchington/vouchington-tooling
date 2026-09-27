import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordFriction } from '../session-friction/index.mts'
import { expect, it } from 'vitest'
import { composeRetrospective, type RetrospectiveCompositionInput } from './index.mts'
const input = (): RetrospectiveCompositionInput => ({
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
  tools: {
    status: 'findings',
    findings: [
      {
        observation: 'Tool retry recovered',
        evidence: 'validated second attempt',
        disposition: 'resolved',
        trackingReference: 'owner/repo#1',
      },
    ],
  },
  architecture: { status: 'none-observed', reason: 'reviewed changed service boundary' },
})
it('generates required factual markers and explicit unknown states without zero estimates', async () => {
  const markdown = await composeRetrospective(input())
  expect(markdown).toContain('## Verifiable Facts\n=== Retrospective Facts ===')
  expect(markdown).toContain('## Transcript Facts\n=== Transcript Facts ===')
  expect(markdown).toContain('Status: not assessed (no transcript selected)')
  expect(markdown).not.toContain('Tool calls: 0')
  expect(markdown).toContain('Tool retry recovered')
  expect(markdown).toContain('Disposition: resolved')
  expect(markdown).toContain('Status: none observed (reviewed changed service boundary)')
})
it('blocks complete coverage for unavailable facts and unscoped assertions', async () => {
  await expect(
    composeRetrospective({
      ...input(),
      feedbackCoverage: { status: 'complete', sources: [], droppedCount: 0 },
    }),
  ).rejects.toThrow(/complete feedback coverage/)
  await expect(
    composeRetrospective({ ...input(), architecture: { status: 'none-observed' } }),
  ).rejects.toThrow(/reason and inspected scope/)
  await expect(composeRetrospective({ ...input(), narrative: 'x'.repeat(12000) })).rejects.toThrow(
    /bounded|large/,
  )
})

it('rejects mismatched assessments and unbounded unavailable reasons', async () => {
  for (const tools of [
    { status: 'invalid' },
    { status: 'findings', findings: [] },
    {
      status: 'none-observed',
      reason: 'scope',
      findings: [{ observation: 'x', evidence: 'y', disposition: 'z' }],
    },
    { status: 'findings', findings: [{ observation: '', evidence: 'y', disposition: 'z' }] },
  ])
    await expect(
      composeRetrospective({ ...input(), tools: tools as RetrospectiveCompositionInput['tools'] }),
    ).rejects.toThrow(/assessment/)
  await expect(
    composeRetrospective({ ...input(), facts: { status: 'unavailable', reason: '' } }),
  ).rejects.toThrow(/reason/)
})
it('generates real collector output and uses typed friction coverage for complete versus partial assessment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-composition-'))
  try {
    const transcript = join(directory, 'transcript.jsonl')
    await writeFile(
      transcript,
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }) + '\n',
    )
    recordFriction('native:owner', { type: 'tool-result', command: 'echo clean' }, { directory })
    const current: RetrospectiveCompositionInput = {
      ...input(),
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
      friction: { directory, journalLoader: () => ({ status: 'not-found' }) },
      tools: { status: 'none-observed', reason: 'inspected tool results' },
      architecture: { status: 'none-observed', reason: 'inspected changed service' },
      feedbackCoverage: {
        status: 'complete',
        sources: ['repository', 'transcript', 'journal', 'friction'],
        droppedCount: 0,
      },
    }
    const markdown = await composeRetrospective(current)
    expect(markdown).toContain('User prompts: 1')
    expect(markdown).toContain('PR state: OPEN')
    expect(markdown).toContain('work_outcome: "success"')
    expect(markdown).toContain('feedback_coverage: {"status":"complete"')
    for (const execute of [
      async () => ({ ok: false, stdout: '', stderr: 'unavailable' }),
      async () => ({ ok: true, stdout: '{', stderr: '' }),
    ]) {
      await expect(
        composeRetrospective({ ...current, facts: { repo: 'owner/repo', pr: '1', execute } }),
      ).rejects.toThrow(/complete feedback coverage/)
    }
    await expect(
      composeRetrospective({
        ...current,
        transcript: { jsonlPath: join(directory, 'missing.jsonl') },
      }),
    ).rejects.toThrow(/complete feedback coverage/)
    recordFriction(
      'native:owner',
      { type: 'permission-request', command: 'git push' },
      { directory, maxEvents: 1 },
    )
    recordFriction(
      'native:owner',
      { type: 'permission-request', command: 'git push' },
      { directory, maxEvents: 1 },
    )
    await expect(
      composeRetrospective({ ...current, friction: { ...current.friction!, maxEvents: 1 } }),
    ).rejects.toThrow(/complete feedback coverage/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('rejects aggregate drop counts below observed friction drops without double counting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feedback-composition-drops-'))
  try {
    const options = { directory, maxEvents: 1 }
    recordFriction('native:owner', { type: 'permission-request', command: 'git push' }, options)
    recordFriction('native:owner', { type: 'permission-request', command: 'git push' }, options)
    const current = {
      ...input(),
      friction: { ...options, journalLoader: () => ({ status: 'not-found' as const }) },
    }
    await expect(composeRetrospective(current)).rejects.toThrow(/observed friction drops/)
    for (const droppedCount of [1, 2]) {
      const markdown = await composeRetrospective({
        ...current,
        feedbackCoverage: { ...current.feedbackCoverage, droppedCount },
      })
      expect(markdown).toContain(`Feedback coverage: partial\nDropped records: ${droppedCount}`)
      expect(markdown).toContain('Status: partial\nDropped records: 1')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('rejects invalid unassessed statuses before invoking either collector', async () => {
  let calls = 0
  const execute = async () => {
    calls++
    return { ok: false, stdout: '', stderr: '' }
  }
  for (const status of ['complete', 'partial', '', ['unavailable'], {}, 1, null]) {
    const invalid = { status, reason: 'no evidence selected' }
    await expect(
      composeRetrospective({
        ...input(),
        facts: invalid as RetrospectiveCompositionInput['facts'],
      }),
    ).rejects.toThrow(/unassessed status/)
    await expect(
      composeRetrospective({
        ...input(),
        facts: { repo: 'owner/repo', pr: '1', execute },
        transcript: invalid as RetrospectiveCompositionInput['transcript'],
      }),
    ).rejects.toThrow(/unassessed status/)
  }
  expect(calls).toBe(0)
})

it('preserves untracked findings without inventing a tracking reference', async () => {
  const current = input()
  current.tools.findings = [
    {
      observation: 'Recovered tool failure',
      evidence: 'Observed successful retry',
      disposition: 'resolved',
    },
  ]
  const markdown = await composeRetrospective(current)
  expect(markdown).toContain('Evidence: Observed successful retry')
  expect(markdown).not.toContain('Tracking:')
})
