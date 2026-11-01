import { describe, expect, it } from 'vitest'

import { indexReviewFiles } from '../gha-review-payload/index.mts'
import { buildFinalReviews, DEFAULT_LIMITS, packBodies, placeFindings } from './build.mts'
import type { FinalReviewInput, Finding } from './finding.mts'

const SHA = 'b'.repeat(40)
const index = indexReviewFiles([
  { filename: 'src/a.ts', patch: '@@ -1,3 +1,4 @@\n one\n+two\n three\n four\n' },
])

function f(overrides: Partial<Finding> = {}): Finding {
  return { pillar: 'rules', severity: 'low', title: 'T', body: 'B', ...overrides }
}

function input(findings: Finding[]): FinalReviewInput {
  return { effort: 'high', summary: '', skipped: [], findings }
}

describe('placeFindings', () => {
  it('places commentable findings and leaves the rest for the body', () => {
    const { comments, offDiff } = placeFindings(
      [
        f({ title: 'nopath' }),
        f({ title: 'pathonly', path: 'src/a.ts' }),
        f({ title: 'ok', severity: 'high', path: 'src/a.ts', line: 2 }),
        f({ title: 'ranged', path: 'src/a.ts', line: 3, startLine: 2 }),
        f({ title: 'unknown file', path: 'src/zzz.ts', line: 1 }),
        f({ title: 'left', path: 'src/a.ts', line: 1, side: 'LEFT' }),
      ],
      index,
    )
    expect(offDiff.map((x) => x.title)).toEqual(['nopath', 'pathonly', 'unknown file'])
    expect(comments.map((c) => `${c.path}:${c.side}:${c.line}`)).toEqual([
      'src/a.ts:RIGHT:2',
      'src/a.ts:RIGHT:3',
      'src/a.ts:LEFT:1',
    ])
    expect(comments[1]).toMatchObject({ start_line: 2, start_side: 'RIGHT' })
    expect(comments[0]?.body).toContain('**[high]** ok')
  })
})

describe('packBodies', () => {
  it('joins blocks while they fit and splits otherwise', () => {
    expect(packBodies('head', ['a', 'b'], 100)).toEqual(['head\n\na\n\nb'])
    expect(packBodies('head', ['aaaa', 'bbbb'], 12)).toEqual(['head\n\naaaa', 'bbbb'])
  })

  it('truncates oversized blocks and an oversized first body', () => {
    const [first, second] = packBodies('h'.repeat(100), ['x'.repeat(100)], 80)
    expect(first).toHaveLength(80)
    expect(first).toContain('_(truncated to fit GitHub limits)_')
    expect(second).toContain('_(truncated to fit GitHub limits)_')
  })

  it('never uses a negative slice for tiny limits', () => {
    expect(packBodies('head', [], 3)[0]).toBe('\n\n_(truncated to fit GitHub limits)_')
  })
})

describe('buildFinalReviews', () => {
  it('builds a single COMMENT review', () => {
    const reviews = buildFinalReviews(
      input([f({ path: 'src/a.ts', line: 2 }), f({ title: 'off' })]),
      SHA,
      index,
    )
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({ event: 'COMMENT', commit_id: SHA })
    expect(reviews[0]?.comments).toHaveLength(1)
    expect(reviews[0]?.body).toContain('### Not on a diff line')
    expect(reviews[0]?.body).toContain('[low] off')
  })

  it('omits the off-diff section when everything is placed', () => {
    const [review] = buildFinalReviews(input([f({ path: 'src/a.ts', line: 2 })]), SHA, index)
    expect(review?.body).not.toContain('Not on a diff line')
  })

  it('splits inline comments across parts', () => {
    const findings = [2, 3, 4].map((line) => f({ path: 'src/a.ts', line, title: `L${line}` }))
    const reviews = buildFinalReviews(input(findings), SHA, index, {
      ...DEFAULT_LIMITS,
      maxComments: 2,
    })
    expect(reviews.map((r) => r.comments.length)).toEqual([2, 1])
    expect(reviews[1]?.body).toContain(`<!-- final-review-part sha=${SHA} part=2 -->`)
    expect(reviews[1]?.body).toContain('part 2 of 2')
    expect(reviews[1]?.body).toContain('Inline findings continued.')
  })

  it('splits long bodies into parts with empty comment lists', () => {
    const findings = [1, 2, 3].map((n) => f({ title: `off${n}`, body: 'z'.repeat(300) }))
    const reviews = buildFinalReviews(input(findings), SHA, index, {
      maxComments: 50,
      maxBodyChars: 900,
    })
    expect(reviews.length).toBeGreaterThan(1)
    expect(reviews[1]?.comments).toEqual([])
    expect(reviews[1]?.body).toContain('part 2 of')
    expect(reviews[1]?.body).toContain('off')
  })
})
