import { describe, expect, it } from 'vitest'
import { parseRetrospectiveFrontMatter } from './retrospective-front-matter.mts'

const doc = (...lines: string[]) => ['---', ...lines, '---', '', 'body'].join('\n')
const REQUIRED = ['date: "2026-01-01"', 'issues: []', 'prs: [1, "a/b#2"]']

describe('parseRetrospectiveFrontMatter', () => {
  it('parses every recognized key', () => {
    expect(
      parseRetrospectiveFrontMatter(
        doc(
          ...REQUIRED,
          'session_id: "s"',
          'description: "d"',
          'work_outcome: "success"',
          'feedback_coverage: {"status":"partial","sources":["x"],"droppedCount":1}',
          'repositories: ["a/b"]',
        ),
      ),
    ).toEqual({
      date: '2026-01-01',
      issues: [],
      prs: [1, 'a/b#2'],
      sessionId: 's',
      description: 'd',
      workOutcome: 'success',
      feedbackCoverage: { status: 'partial', sources: ['x'], droppedCount: 1 },
      repositories: ['a/b'],
    })
    expect(parseRetrospectiveFrontMatter(doc(...REQUIRED))).toEqual({
      date: '2026-01-01',
      issues: [],
      prs: [1, 'a/b#2'],
    })
  })

  it('ignores the blank lines composeRetrospective puts between entries', () => {
    expect(
      parseRetrospectiveFrontMatter(doc(...REQUIRED.flatMap((line) => [line, '']))).prs,
    ).toEqual([1, 'a/b#2'])
  })

  it('accepts a block at the very end of the document', () => {
    expect(parseRetrospectiveFrontMatter(`---\n${REQUIRED.join('\n')}\n---`).date).toBe(
      '2026-01-01',
    )
  })

  it('rejects a missing block', () => {
    expect(() => parseRetrospectiveFrontMatter('body')).toThrow('must start with a block')
    expect(() => parseRetrospectiveFrontMatter(`x\n${doc(...REQUIRED)}`)).toThrow('must start')
  })

  it.each([
    [['nonsense'], 'malformed line "nonsense"'],
    [['Bad Key: 1'], 'malformed line'],
    [['other: 1'], 'unknown key other'],
    [[...REQUIRED, 'date: "2026-01-02"'], 'duplicate key date'],
    [['date: 2026-01-01', 'issues: []', 'prs: []'], 'date is not a JSON value'],
    [['date: "26-1-1"', 'issues: []', 'prs: []'], 'date must be'],
    [['date: "2026-01-01"', 'prs: []'], 'issues must be'],
    [['date: "2026-01-01"', 'issues: [0]', 'prs: []'], 'issues must be'],
    [['date: "2026-01-01"', 'issues: [""]', 'prs: []'], 'issues must be'],
    [['date: "2026-01-01"', 'issues: [1.5]', 'prs: []'], 'issues must be'],
    [['date: "2026-01-01"', 'issues: []', 'prs: {}'], 'prs must be'],
    [[...REQUIRED, 'session_id: 5'], 'session_id must be a string'],
    [[...REQUIRED, 'repositories: "a/b"'], 'repositories must be an array'],
    [[...REQUIRED, 'feedback_coverage: 3'], 'feedback_coverage must be'],
    [[...REQUIRED, 'feedback_coverage: null'], 'feedback_coverage must be'],
    [
      [...REQUIRED, 'feedback_coverage: {"status":"x","sources":[],"droppedCount":0,"z":1}'],
      'feedback_coverage must be',
    ],
    [
      [...REQUIRED, 'feedback_coverage: {"status":"x","sources":[1],"droppedCount":0}'],
      'feedback_coverage must be',
    ],
  ])('rejects %j', (lines, message) => {
    expect(() => parseRetrospectiveFrontMatter(doc(...lines))).toThrow(message)
  })
})
