import { describe, expect, it } from 'vitest'

import {
  extractPartialBatchSourceRef,
  extractRelatedIssuesLines,
  extractRelatedIssuesReferenceText,
  findEscapeCommentClosingKeywordLeaks,
  hasRelatedIssuesNoSourcePair,
  sanitizedLines,
  validatePartialBatchSourceRef,
  validatePrDescriptionContent,
} from './index.mts'

describe('sanitizedLines', () => {
  it('blanks fenced code blocks (backtick and tilde) and rejects tab-indented closing lookalikes', () => {
    const body = [
      'Visible before',
      '```md',
      'Hidden inside fence',
      '\t```',
      'Still hidden',
      '```  ',
      'Visible middle',
      '~~~text',
      'Hidden in tilde',
      '~~~~',
      'Visible after',
    ].join('\n')

    const lines = sanitizedLines(body)
    expect(lines).toContain('Visible before')
    expect(lines).toContain('Visible middle')
    expect(lines).toContain('Visible after')
    expect(lines).not.toContain('Hidden inside fence')
    expect(lines).not.toContain('Still hidden')
    expect(lines).not.toContain('Hidden in tilde')
  })

  it('keeps complete single-line HTML comments while blanking multi-line and reopened comments', () => {
    const body = [
      '<!-- marker-one -->',
      '<!-- harmless --> <!--',
      'Hidden inside multi-line comment',
      'Still hidden -->',
      'After comment',
      '<!-- unclosed',
      'Hidden to EOF',
    ].join('\n')

    const lines = sanitizedLines(body)
    expect(lines[0]).toBe('<!-- marker-one -->')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('')
    expect(lines[3]).toBe('')
    expect(lines[4]).toBe('After comment')
    expect(lines[5]).toBe('')
    expect(lines[6]).toBe('')
  })

  it('blanks CDATA, declarations, processing instructions, HTML blocks, and inline code lines', () => {
    const body = [
      'Line 1',
      '<![CDATA[single line]]>',
      '<?pi single?>',
      '<!doctype html>',
      '  <![CDATA[',
      'hidden cdata line',
      ']]>',
      '<?xml',
      'hidden pi line',
      '?>',
      '<!DOCTYPE',
      'hidden decl line',
      '>',
      'Mid-line <?unclosed stays visible',
      'Inline `code` line',
      '<div>',
      'inside html block',
      '</div>',
      '',
      'Visible end',
    ].join('\n')

    const lines = sanitizedLines(body)
    expect(lines).toContain('Line 1')
    expect(lines).toContain('Mid-line <?unclosed stays visible')
    expect(lines).toContain('Visible end')
    expect(lines).not.toContain('hidden cdata line')
    expect(lines).not.toContain('hidden pi line')
    expect(lines).not.toContain('hidden decl line')
    expect(lines).not.toContain('Inline `code` line')
    expect(lines).not.toContain('inside html block')
  })
})

describe('content-policy', () => {
  it('blanks literal spans in Related issues while keeping newlines and visible text', () => {
    const body = [
      '## Summary',
      '',
      'Fix validation.',
      '',
      '## Impact',
      '',
      'None.',
      '',
      '## Related issues',
      '',
      '- Refs #42 — active',
      '- `Refs #99` and <!-- Refs #100 -->',
      '```',
      'Refs #101',
      '```',
    ].join('\n')

    const refText = extractRelatedIssuesReferenceText(body)
    expect(refText).toContain('Refs #42')
    expect(refText).not.toContain('#99')
    expect(refText).not.toContain('#100')
    expect(refText).not.toContain('#101')
    expect(extractRelatedIssuesReferenceText('No heading here')).toBe('')
  })

  it('extracts sanitized lines from Related issues and handles missing section', () => {
    expect(extractRelatedIssuesLines('## Summary\n\nText')).toEqual([])
    const lines = extractRelatedIssuesLines('## Related issues\n\n- Closes #7\n')
    expect(lines).toContain('## Related issues')
    expect(lines).toContain('- Closes #7')
  })

  it('validates required headings and customizable policy messages', () => {
    const missing = validatePrDescriptionContent('## Other\n\nText', {
      diagnosticPrefix: 'Custom',
      missingRelatedIssuesMessage: 'Custom missing related issues.',
      requiredHeadings: ['Summary'],
    })
    expect(missing.relatedIssuesSection).toBeUndefined()
    expect(missing.errors).toEqual([
      'Custom: Missing required section: Summary.',
      'Custom missing related issues.',
    ])

    const defaultMissing = validatePrDescriptionContent('## Summary\n\nOk\n\n## Impact\n\nOk')
    expect(defaultMissing.errors).toEqual([
      'PR body must include a "## Related issues" section (e.g. a heading followed by "Closes #123").',
    ])
  })
})

describe('no-source and partial-batch helpers', () => {
  const DIRECT_TEMPLATE = {
    marker: '<!-- related-issues-validation: no-source-direct-request -->',
    visibleLine: 'No source issue; direct user request.',
  }
  const SCHEDULED_TEMPLATE = {
    marker: '<!-- related-issues-validation: no-source-scheduled-prompt -->',
    requiredBodyLines: new Set(['Workspace setup: Scheduled runner']),
    visibleLine: 'No source issue; scheduled prompt run.',
  }
  const PARTIAL_TEMPLATE = {
    marker: '<!-- related-issues-validation: partial-batch -->',
    visibleLine: 'Partial batch; source issue remains open for remaining work.',
  }

  it('matches no-source line pairs with and without requiredBodyLines', () => {
    const directBody = `## Related issues\n\n${DIRECT_TEMPLATE.visibleLine}\n${DIRECT_TEMPLATE.marker}\n`
    expect(hasRelatedIssuesNoSourcePair(directBody, DIRECT_TEMPLATE)).toBe(true)
    expect(hasRelatedIssuesNoSourcePair('## Related issues\n\nOther\n', DIRECT_TEMPLATE)).toBe(
      false,
    )

    const scheduledWithoutSetup = `## Related issues\n\n${SCHEDULED_TEMPLATE.visibleLine}\n${SCHEDULED_TEMPLATE.marker}\n`
    expect(hasRelatedIssuesNoSourcePair(scheduledWithoutSetup, SCHEDULED_TEMPLATE)).toBe(false)

    const scheduledWithSetup = `${scheduledWithoutSetup}\nWorkspace setup: Scheduled runner\n`
    expect(hasRelatedIssuesNoSourcePair(scheduledWithSetup, SCHEDULED_TEMPLATE)).toBe(true)
  })

  it('matches required body lines by whole-line pattern alongside exact lines', () => {
    const pair = `## Related issues\n\n${SCHEDULED_TEMPLATE.visibleLine}\n${SCHEDULED_TEMPLATE.marker}\n`
    const patternOnly = {
      marker: SCHEDULED_TEMPLATE.marker,
      visibleLine: SCHEDULED_TEMPLATE.visibleLine,
      requiredBodyLinePatterns: [/Workspace setup: [\w-]+ scheduled prompt/],
    }
    const withSetup = (setup: string) => `${pair}\nWorkspace setup: ${setup}\n`
    expect(hasRelatedIssuesNoSourcePair(withSetup('pg-schema scheduled prompt'), patternOnly)).toBe(
      true,
    )
    expect(hasRelatedIssuesNoSourcePair(pair, patternOnly)).toBe(false)
    // A pattern must match the whole line, not a prefix or a substring.
    expect(
      hasRelatedIssuesNoSourcePair(withSetup('pg-schema scheduled prompt, then more'), patternOnly),
    ).toBe(false)
    expect(
      hasRelatedIssuesNoSourcePair(
        `${pair}\nNote: Workspace setup: x scheduled prompt\n`,
        patternOnly,
      ),
    ).toBe(false)

    // Lazy quantifiers and a short earlier alternative still find the whole-line match.
    const lazy = { ...patternOnly, requiredBodyLinePatterns: [/Workspace setup: .+?/] }
    expect(hasRelatedIssuesNoSourcePair(withSetup('triage-loop scheduled prompt'), lazy)).toBe(true)
    const alternatives = {
      ...patternOnly,
      requiredBodyLinePatterns: [/Workspace setup: a|Workspace setup: a scheduled prompt/],
    }
    expect(hasRelatedIssuesNoSourcePair(withSetup('a scheduled prompt'), alternatives)).toBe(true)
    expect(hasRelatedIssuesNoSourcePair(withSetup('a scheduled prompt!'), alternatives)).toBe(false)
    // Flags are preserved.
    const caseless = {
      ...patternOnly,
      requiredBodyLinePatterns: [/workspace setup: \S+ SCHEDULED prompt/i],
    }
    expect(hasRelatedIssuesNoSourcePair(withSetup('pg-schema scheduled prompt'), caseless)).toBe(
      true,
    )

    const both = { ...patternOnly, requiredBodyLines: SCHEDULED_TEMPLATE.requiredBodyLines }
    expect(hasRelatedIssuesNoSourcePair(withSetup('Scheduled runner'), both)).toBe(true)
    expect(hasRelatedIssuesNoSourcePair(withSetup('triage-loop scheduled prompt'), both)).toBe(true)
    expect(hasRelatedIssuesNoSourcePair(withSetup('fresh worktree'), both)).toBe(false)
  })

  it.each([/Workspace setup: .+/g, /Workspace setup: .+/y])(
    'rejects stateful %s required body line patterns',
    (pattern) => {
      const body = `## Related issues\n\n${SCHEDULED_TEMPLATE.visibleLine}\n${SCHEDULED_TEMPLATE.marker}\n`
      const template = { ...SCHEDULED_TEMPLATE, requiredBodyLinePatterns: [pattern] }
      expect(() => hasRelatedIssuesNoSourcePair(body, template)).toThrow(TypeError)
    },
  )

  it('extracts a single local or cross-repo partial-batch source ref and rejects ambiguity', () => {
    const localBody = [
      '## Related issues',
      '',
      '- Refs #42 — first slice',
      PARTIAL_TEMPLATE.visibleLine,
      PARTIAL_TEMPLATE.marker,
    ].join('\n')
    expect(extractPartialBatchSourceRef(localBody, PARTIAL_TEMPLATE)).toEqual({
      key: '#42',
      number: 42,
      owner: undefined,
      repo: undefined,
    })

    const foreignBody = [
      '## Related issues',
      '',
      '- Refs Acme/Repo#99 — cross-repo slice',
      PARTIAL_TEMPLATE.visibleLine,
      PARTIAL_TEMPLATE.marker,
    ].join('\n')
    expect(extractPartialBatchSourceRef(foreignBody, PARTIAL_TEMPLATE)).toEqual({
      key: 'acme/repo#99',
      number: 99,
      owner: 'acme',
      repo: 'repo',
    })

    const ambiguousBody = [
      '## Related issues',
      '',
      '- Refs #1 — first',
      '- Refs #2 — second',
      PARTIAL_TEMPLATE.visibleLine,
      PARTIAL_TEMPLATE.marker,
    ].join('\n')
    expect(extractPartialBatchSourceRef(ambiguousBody, PARTIAL_TEMPLATE)).toBeUndefined()

    const noRefAboveBody = [
      '## Related issues',
      '',
      PARTIAL_TEMPLATE.visibleLine,
      PARTIAL_TEMPLATE.marker,
    ].join('\n')
    expect(extractPartialBatchSourceRef(noRefAboveBody, PARTIAL_TEMPLATE)).toBeUndefined()

    const hugeNumberBody = [
      '## Related issues',
      '',
      '- Refs #99999999999999999999999 — overflow',
      PARTIAL_TEMPLATE.visibleLine,
      PARTIAL_TEMPLATE.marker,
    ].join('\n')
    expect(extractPartialBatchSourceRef(hugeNumberBody, PARTIAL_TEMPLATE)).toBeUndefined()
  })

  it('validates partial-batch source issue lookups', () => {
    const ref = { key: '#42', number: 42, owner: undefined, repo: undefined }
    const openIssue = {
      body: '',
      isPullRequest: false,
      milestone: undefined,
      number: 42,
      state: 'open',
      title: 'Batch',
      url: 'https://github.com/acme/repo/issues/42',
    }
    expect(validatePartialBatchSourceRef(undefined, undefined)).toEqual([])
    expect(validatePartialBatchSourceRef(ref, undefined)).toEqual([])
    expect(validatePartialBatchSourceRef(ref, { error: '404', ok: false })).toEqual([
      '#42 could not be resolved: 404. A partial batch requires an existing open source issue.',
    ])
    expect(
      validatePartialBatchSourceRef(ref, {
        issue: { ...openIssue, isPullRequest: true },
        ok: true,
      }),
    ).toEqual([
      '#42 is a pull request, not an issue. A partial batch requires an existing open source issue.',
    ])
    expect(
      validatePartialBatchSourceRef(ref, { issue: { ...openIssue, state: 'closed' }, ok: true }),
    ).toEqual(['#42 is CLOSED. A partial batch requires an existing open source issue.'])
    expect(
      validatePartialBatchSourceRef(
        ref,
        { issue: { ...openIssue, state: 'closed' }, ok: true },
        true,
      ),
    ).toEqual([])
    expect(validatePartialBatchSourceRef(ref, { issue: openIssue, ok: true })).toEqual([])
  })
})

describe('findEscapeCommentClosingKeywordLeaks', () => {
  it('reports leaks, truncates long reasons and large ref lists, and caps total diagnostics', () => {
    expect(
      findEscapeCommentClosingKeywordLeaks(
        '<!-- related-issues-validation: allow #1 because tracked in follow-up #2 -->',
      ),
    ).toEqual([])

    const manyRefs = Array.from({ length: 12 }, (_, idx) => `closes #${idx + 1}`).join(' ')
    const longReason = `${manyRefs} ${'x'.repeat(250)}`
    const singleLeak = findEscapeCommentClosingKeywordLeaks(
      `<!-- related-issues-validation: allow #1 because ${longReason} -->`,
    )
    expect(singleLeak).toHaveLength(1)
    expect(singleLeak[0]).toContain('#10, and 2 more')
    expect(singleLeak[0]).toContain('…')

    const twentyOneLeaks = Array.from(
      { length: 21 },
      (_, idx) => `<!-- related-issues-validation: allow #${idx + 1} because fixes #${idx + 1} -->`,
    ).join('\n')
    const capped = findEscapeCommentClosingKeywordLeaks(twentyOneLeaks)
    expect(capped).toHaveLength(21)
    expect(capped[20]).toContain('beyond the first 20 shown above')
  })
})
