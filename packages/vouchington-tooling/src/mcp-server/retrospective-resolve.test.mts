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

  it('reports every mismatch at once', () => {
    expect(() =>
      checkFrontMatter({ ...BARE, sessionId: 'x', workOutcome: 'failure' }, ARGS),
    ).toThrow('session_id does not match sessionId; work_outcome does not match workOutcome')
  })
})
