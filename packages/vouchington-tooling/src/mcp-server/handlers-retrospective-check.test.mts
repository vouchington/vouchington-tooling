import { describe, expect, it } from 'vitest'
import { harness, jsonOf, useRepoFixture } from './harness.test-helpers.mts'

const fixture = useRepoFixture()

const versioned = {
  schemaVersion: 1,
  type: 'retrospective',
  sourceEventId: 'event:1',
  timestamp: '2026-01-01T00:00:00.000Z',
  date: '2026-01-01',
  issues: [1],
  prs: [],
  repositories: ['owner/repo'],
  markdown: 'A retrospective',
  workOutcome: 'unknown',
  feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
}

async function check(data: Record<string, unknown>) {
  const h = harness(fixture(), {
    entries: [{ createdAt: '2026-01-01T00:00:00.000Z', data }],
  })
  return jsonOf(await h.call('retrospective_check', { sessionId: 's', sourceEventId: 'event:1' }))
}

describe('retrospective_check envelope validation', () => {
  it('counts a valid schema-versioned entry as saved', async () => {
    expect(await check(versioned)).toMatchObject({ saved: true })
  })

  it('does not count a malformed schema-versioned entry as saved', async () => {
    expect(await check({ ...versioned, markdown: '' })).toEqual({
      sessionId: 's',
      saved: false,
      entries: [],
    })
    expect(await check({ ...versioned, workOutcome: 'bogus' })).toMatchObject({ saved: false })
  })

  it('still counts an unversioned legacy entry as saved', async () => {
    expect(
      await check({ type: 'retrospective', sourceEventId: 'event:1', markdown: 'legacy' }),
    ).toMatchObject({ saved: true })
  })
})
