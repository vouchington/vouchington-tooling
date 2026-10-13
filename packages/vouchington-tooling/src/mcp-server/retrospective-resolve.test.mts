import { describe, expect, it } from 'vitest'
import type { FeedbackCoverage } from '../agent-blackboard/index.mts'
import { checkFrontMatter } from './retrospective-resolve.mts'

const COVERAGE: FeedbackCoverage = { status: 'complete', sources: ['tool-result'], droppedCount: 0 }
const ARGS = {
  sessionId: 'native:owner',
  workOutcome: 'success',
  feedbackCoverage: COVERAGE,
  repositories: ['owner/repo'] as string[] | undefined,
}
const BARE = { date: '2026-01-01', issues: [], prs: [] }

describe('checkFrontMatter', () => {
  it('accepts front matter that omits every optional field', () => {
    expect(() => checkFrontMatter(BARE, ARGS)).not.toThrow()
  })

  it('accepts front matter that agrees with the arguments', () => {
    expect(() =>
      checkFrontMatter(
        {
          ...BARE,
          sessionId: 'native:owner',
          workOutcome: 'success',
          feedbackCoverage: COVERAGE,
          repositories: ['Owner/Repo'],
        },
        ARGS,
      ),
    ).not.toThrow()
  })

  it('does not compare front matter repositories when the argument omits them', () => {
    expect(() =>
      checkFrontMatter({ ...BARE, repositories: ['a/b'] }, { ...ARGS, repositories: undefined }),
    ).not.toThrow()
  })

  it('compares feedback coverage by field, ignoring key order but not source order', () => {
    const reordered = { sources: ['tool-result'], droppedCount: 0, status: 'complete' as const }
    expect(() => checkFrontMatter({ ...BARE, feedbackCoverage: reordered }, ARGS)).not.toThrow()
    const coverage = (patch: Partial<FeedbackCoverage>) => ({
      ...BARE,
      feedbackCoverage: { ...COVERAGE, ...patch },
    })
    const two = { ...ARGS, feedbackCoverage: { ...COVERAGE, sources: ['a', 'b'] } }
    for (const [front, args] of [
      [coverage({ status: 'partial' }), ARGS],
      [coverage({ droppedCount: 1 }), ARGS],
      [coverage({ sources: ['b', 'a'] }), two],
    ] as const)
      expect(() => checkFrontMatter(front, args)).toThrow(
        'feedback_coverage does not match feedbackCoverage',
      )
  })

  it('reports every mismatch at once', () => {
    expect(() =>
      checkFrontMatter({ ...BARE, sessionId: 'x', workOutcome: 'failure' }, ARGS),
    ).toThrow('session_id does not match sessionId; work_outcome does not match workOutcome')
  })
})
