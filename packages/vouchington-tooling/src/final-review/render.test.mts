import { describe, expect, it } from 'vitest'

import type { FinalReviewInput, Finding } from './finding.mts'
import {
  deriveVerdict,
  locationText,
  renderBodyFinding,
  renderFindingBody,
  renderHeader,
  reviewMarker,
  severityTag,
  sortFindings,
} from './render.mts'

function f(overrides: Partial<Finding> = {}): Finding {
  return { pillar: 'rules', severity: 'low', title: 'Title', body: 'Body', ...overrides }
}

const SHA = 'a'.repeat(40)

describe('verdict and tags', () => {
  it('derives the verdict from the worst severity', () => {
    expect(deriveVerdict([])).toBe('Approve')
    expect(deriveVerdict([f({ severity: 'medium' })])).toBe('Approve')
    expect(deriveVerdict([f({ severity: 'high' }), f()])).toBe('Comment')
    expect(deriveVerdict([f({ severity: 'high' }), f({ severity: 'blocking' })])).toBe(
      'Request Changes',
    )
    expect(severityTag('high')).toBe('[high]')
  })

  it('formats the marker with a dashed verdict', () => {
    expect(reviewMarker(SHA, 'Request Changes', 'low')).toBe(
      `<!-- final-review sha=${SHA} verdict=Request-Changes effort=low -->`,
    )
  })

  it('sorts by severity without mutating the input', () => {
    const input = [f({ severity: 'low' }), f({ severity: 'blocking' }), f({ severity: 'high' })]
    expect(sortFindings(input).map((x) => x.severity)).toEqual(['blocking', 'high', 'low'])
    expect(input[0]?.severity).toBe('low')
  })
})

describe('locationText', () => {
  it('describes none, path, line, and range', () => {
    expect(locationText(f())).toBe('')
    expect(locationText(f({ path: 'a.ts' }))).toBe('`a.ts`')
    expect(locationText(f({ path: 'a.ts', line: 5 }))).toBe('`a.ts:5`')
    expect(locationText(f({ path: 'a.ts', line: 5, startLine: 2 }))).toBe('`a.ts:2-5`')
  })
})

describe('finding bodies', () => {
  it('keeps short bodies inline', () => {
    expect(renderFindingBody(f())).toBe('**[low]** Title\n\n<sub>rules</sub>\n\nBody')
  })

  it('collapses bodies that are too long or have too many lines', () => {
    const long = renderFindingBody(f({ body: 'x'.repeat(401) }))
    expect(long).toContain('<details><summary>Details</summary>')
    const tall = renderFindingBody(f({ body: 'a\nb\nc\nd\ne' }))
    expect(tall).toContain('<details>')
    expect(renderFindingBody(f({ body: 'a\nb\nc\nd' }))).not.toContain('<details>')
  })

  it('renders body findings with and without a location', () => {
    expect(renderBodyFinding(f())).toBe(
      '<details><summary>[low] Title</summary>\n\n<sub>rules</sub>\n\nBody\n\n</details>',
    )
    expect(renderBodyFinding(f({ path: 'a.ts', line: 3 }))).toContain(
      '<summary>[low] Title (a.ts:3)</summary>',
    )
  })
})

describe('renderHeader', () => {
  const input = (overrides: Partial<FinalReviewInput> = {}): FinalReviewInput => ({
    effort: 'medium',
    summary: '',
    skipped: [],
    findings: [],
    ...overrides,
  })

  it('renders a minimal approving header', () => {
    expect(renderHeader(input(), SHA)).toBe(
      [
        reviewMarker(SHA, 'Approve', 'medium'),
        '## [Approve] Final review',
        `Reviewed \`${'a'.repeat(12)}\` at medium effort · no findings`,
      ].join('\n\n'),
    )
  })

  it('renders summary, counts, index, and skipped pillars', () => {
    const out = renderHeader(
      input({
        summary: 'Overall fine.',
        skipped: [{ pillar: 'history', reason: 'shallow clone' }],
        findings: [
          f({ title: 'Low one' }),
          f({ severity: 'blocking', title: 'Bad', path: 'a.ts', line: 1 }),
          f({ severity: 'blocking', title: 'Worse' }),
        ],
      }),
      SHA,
    )
    expect(out).toContain('## [Request Changes] Final review')
    expect(out).toContain('3 findings (2 blocking, 1 low)')
    expect(out).toContain('Overall fine.')
    expect(out).toContain(
      '- **[blocking]** Bad — `a.ts:1`\n- **[blocking]** Worse\n- **[low]** Low one',
    )
    expect(out).toContain('<summary>Skipped pillars (1)</summary>')
    expect(out).toContain('- **history**: shallow clone')
  })

  it('uses the singular noun for one finding', () => {
    expect(renderHeader(input({ findings: [f({ severity: 'medium' })] }), SHA)).toContain(
      '1 finding (1 medium)',
    )
  })
})
