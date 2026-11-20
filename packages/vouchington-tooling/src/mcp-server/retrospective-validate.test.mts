import { describe, expect, it } from 'vitest'
import { ASSESSED_SECTIONS, UNASSESSED_SECTIONS } from './retrospective-sections.test-helpers.mts'
import { validateRetrospectiveMarkdown } from './retrospective-validate.mts'

const group = (source = 'GitHub Actions', tail = ''): string =>
  [
    `- \`one-off\` — \`${source}\` — lint timed out`,
    '  - Evidence: run 42',
    '  - Root diagnostic: runner starvation',
    `  - Disposition: reran${tail}`,
  ].join('\n')

const withCi = (body: string): string =>
  ASSESSED_SECTIONS.replace('## CI Failures\nStatus: none observed', `## CI Failures\n${body}`)

const check = (markdown: string, status = 'partial'): string[] =>
  validateRetrospectiveMarkdown(markdown, status)

describe('required headers and markers', () => {
  it('accepts a conforming document, including CRLF line endings', () => {
    expect(check(ASSESSED_SECTIONS, 'complete')).toEqual([])
    expect(check(ASSESSED_SECTIONS.replaceAll('\n', '\r\n'), 'complete')).toEqual([])
    expect(check(ASSESSED_SECTIONS.replaceAll('\n', '\r'), 'complete')).toEqual([])
  })

  it.each([
    '## Verifiable Facts',
    '=== Retrospective Facts ===',
    '## Transcript Facts',
    '=== Transcript Facts ===',
  ])('names the missing line %s', (line) => {
    const errors = check(ASSESSED_SECTIONS.replace(`${line}\n`, ''))
    expect(errors).toContain(`missing the required line "${line}"`)
  })

  it('reports an empty document with every missing piece', () => {
    expect(check('Just prose.')).toHaveLength(7)
  })
})

describe('## CI Failures', () => {
  it('accepts failures observed with a group, an excluded note, and unavailable with a reason', () => {
    expect(check(withCi(`Status: failures observed\nExcluded: 1 blocks\n\n${group()}`))).toEqual([])
    expect(check(withCi('Status: none observed\nExcluded: 2 blocks from before r1'))).toEqual([])
    expect(check(withCi('Status: unavailable (journal scan incomplete)'))).toEqual([])
    // A truncated journal scan still renders the groups it read under an unavailable status.
    expect(check(withCi(`Status: unavailable (journal scan incomplete)\n\n${group()}`))).toEqual([])
  })

  it('requires the section exactly once', () => {
    expect(
      check(ASSESSED_SECTIONS.replace('## CI Failures\nStatus: none observed\n\n', '')),
    ).toEqual(['missing "## CI Failures" section header'])
    expect(check(`${ASSESSED_SECTIONS}\n\n## CI Failures\nStatus: none observed`)).toEqual([
      '"## CI Failures" must appear exactly once',
    ])
  })

  it('requires the section immediately after Transcript Facts', () => {
    const moved = ASSESSED_SECTIONS.replace(
      '## CI Failures\nStatus: none observed\n\n',
      '## Plan vs Actual\nSkipped.\n\n## CI Failures\nStatus: none observed\n\n',
    )
    expect(check(moved)).toEqual([
      '"## CI Failures" must come immediately after "## Transcript Facts"',
    ])
    const before = `## CI Failures\nStatus: none observed\n\n${ASSESSED_SECTIONS.replace(
      '## CI Failures\nStatus: none observed\n\n',
      '',
    )}`
    expect(check(before)).toEqual([
      '"## CI Failures" must come immediately after "## Transcript Facts"',
    ])
  })

  it('does not blame the position when Transcript Facts itself is missing', () => {
    const errors = check(ASSESSED_SECTIONS.replace('## Transcript Facts\n', ''))
    expect(errors).toEqual(['missing the required line "## Transcript Facts"'])
  })

  it('requires exactly one valid Status line', () => {
    expect(check(withCi('Status: none observed\nStatus: none observed'))[0]).toContain('(found 2)')
    expect(check(withCi(''))[0]).toContain('(found 0)')
    expect(check(withCi('Status: maybe'))[0]).toContain('status "Status: maybe" is invalid')
    expect(check(withCi('Status: unavailable ( )'))[0]).toContain('is invalid')
  })

  it('ties the status to whether groups exist', () => {
    expect(check(withCi('Status: failures observed'))).toEqual([
      '"Status: failures observed" requires at least one failure group under "## CI Failures"',
    ])
    expect(check(withCi(`Status: none observed\n\n${group()}`))[0]).toContain(
      'use "Status: failures observed"',
    )
  })

  it('requires evidence, root diagnostic and disposition in order, non-blank', () => {
    const missingDisposition = group().split('\n').slice(0, 3).join('\n')
    expect(check(withCi(`Status: failures observed\n\n${missingDisposition}`))[0]).toContain(
      'each failure group needs',
    )
    const swapped = [
      '- `one-off` — `GitHub Actions` — lint',
      '  - Root diagnostic: x',
      '  - Evidence: y',
      '  - Disposition: z',
    ].join('\n')
    expect(check(withCi(`Status: failures observed\n\n${swapped}`))[0]).toContain('in that order')
  })

  it('accepts only GitHub Actions as a failure source', () => {
    const errors = check(withCi(`Status: failures observed\n\n${group('Jenkins')}`))
    expect(errors).toEqual(['failure group source must be `GitHub Actions`, not `Jenkins`'])
  })

  it('rejects unexpected lines but ignores the next section', () => {
    const errors = check(withCi('Status: none observed\nSome stray prose.'))
    expect(errors[0]).toContain('unexpected content inside "## CI Failures": "Some stray prose."')
    expect(
      check(withCi(`Status: failures observed\n\n${group('GitHub Actions')}\n  - extra`))[0],
    ).toContain('unexpected content')
  })
})

describe('Tool Findings and Architecture Findings', () => {
  const finding = '- Slow hook\n  - Evidence: 12s run\n  - Disposition: filed #4'
  const withTools = (body: string): string =>
    ASSESSED_SECTIONS.replace(
      '## Tool Findings\nStatus: none observed (read the tool results)',
      `## Tool Findings\n${body}`,
    )

  it('accepts findings with evidence and disposition, with or without a reason', () => {
    expect(check(withTools(`Status: findings\n${finding}\n  - Tracking: #4`))).toEqual([])
    expect(
      check(
        withTools(
          `Status: findings (read logs)\n${finding}\n- Another\n  - Evidence: a\n  - Disposition: b`,
        ),
      ),
    ).toEqual([])
    expect(check(withTools('Status: not assessed (skipped)'))).toEqual([])
    expect(check(withTools('Status: unavailable (no access)'))).toEqual([])
  })

  it('requires each section exactly once', () => {
    expect(check(ASSESSED_SECTIONS.replace('## Architecture Findings', '## Other'))).toEqual([
      'missing "## Architecture Findings" section',
    ])
    expect(check(`${ASSESSED_SECTIONS}\n\n## Tool Findings\nStatus: none observed (x)`)).toEqual([
      '"## Tool Findings" must appear exactly once',
    ])
  })

  it('requires one bounded status', () => {
    expect(check(withTools(''))).toEqual([
      '"## Tool Findings" needs exactly one "Status: " line (found 0)',
    ])
    expect(check(withTools(`Status: findings (${'x'.repeat(320)})\n${finding}`))).toEqual([
      '"## Tool Findings" status must be at most 320 bytes',
    ])
  })

  it('rejects a status without a reason, or an unknown status', () => {
    expect(check(withTools('Status: none observed'))[0]).toContain('must be "Status: findings"')
    expect(check(withTools('Status: all good (fine)'))[0]).toContain('must be "Status: findings"')
  })

  it('rejects bullets under a non-finding status and findings with no bullet', () => {
    expect(check(withTools(`Status: none observed (x)\n${finding}`))[0]).toContain(
      'lists findings but its status says there are none',
    )
    expect(check(withTools('Status: findings'))[0]).toContain('lists no finding')
  })

  it('names the missing evidence or disposition of each finding', () => {
    expect(check(withTools('Status: findings\n- Slow hook\n  - Disposition: filed'))[0]).toContain(
      'is missing "  - Evidence: ..."',
    )
    expect(check(withTools(`Status: findings\n${finding}\n- Second`))[0]).toContain(
      'is missing "  - Evidence: ..." and "  - Disposition: ..."',
    )
  })
})

describe('complete feedback coverage', () => {
  it('accepts unassessed sources under any other status', () => {
    expect(check(UNASSESSED_SECTIONS, 'partial')).toEqual([])
    expect(check(UNASSESSED_SECTIONS, 'unavailable')).toEqual([])
  })

  it('rejects complete coverage and names every unassessed source with its section', () => {
    const [error, ...rest] = check(UNASSESSED_SECTIONS, 'complete')
    expect(rest).toEqual([])
    expect(error).toContain('feedbackCoverage "complete" contradicts unassessed sources')
    expect(error).toContain('"Status: unavailable (n/a)" in "=== Retrospective Facts ==="')
    expect(error).toContain('"Status: not assessed (no transcript)" in "=== Transcript Facts ==="')
    expect(error).toContain('"Status: unavailable (not assessed)" in "## CI Failures"')
    expect(error).toContain('"Status: not assessed (skipped)" in "## Tool Findings"')
    expect(error).toContain('save with a feedbackCoverage status other than "complete"')
  })

  it('rejects a partial status line and one before any section', () => {
    const error = check(`Status: partial (half)\n${ASSESSED_SECTIONS}`, 'complete')[0]
    expect(error).toContain('"Status: partial (half)" in the front of the document')
  })
})
