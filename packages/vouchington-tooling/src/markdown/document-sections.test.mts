import { describe, expect, it } from 'vitest'

import { parseMarkdownSections, validateMarkdownSections } from './index.mts'

const policy = { requiredHeadings: ['Summary', 'Impact'] }

describe('Markdown document sections', () => {
  it('accepts visible prose, lists, and populated tables with caller-owned headings', () => {
    for (const content of [
      'Readers can reopen the dialog safely.',
      '- Readers can reopen the dialog safely.',
      '| Audience | Change |\n| --- | --- |\n| Readers | Safe reopen |',
    ]) {
      const document = parseMarkdownSections(
        `## Summary\n\n${content}\n\n## Impact\n\nNo stale reset.`,
      )
      expect(validateMarkdownSections(document, policy)).toEqual([])
      expect(document.sections.map((section) => section.hasVisibleContent)).toEqual([true, true])
    }
    expect(
      validateMarkdownSections(parseMarkdownSections('## Result\n\nComplete.'), {
        requiredHeadings: ['Result'],
      }),
    ).toEqual([])
  })

  it('returns exact Unicode and CRLF source ranges without reformatting', () => {
    const body =
      '😀 preface\r\n\r\n## **Summary** <!-- note -->\r\n\r\nBefore → after.\r\n\r\n## Impact\r\n\r\nReaders benefit.\r\n'
    const document = parseMarkdownSections(body)
    expect(document.sections.map((section) => section.heading)).toEqual(['Summary', 'Impact'])
    expect(document.sections[0]).toMatchObject({
      content: '\r\n\r\nBefore → after.\r\n\r\n',
      line: 3,
      endOffset: body.indexOf('## Impact'),
    })
    for (const section of document.sections) {
      expect(body.slice(section.startOffset, section.endOffset)).toBe(section.content)
    }
    expect(document.sections[1]?.endOffset).toBe(body.length)
  })

  it('uses visible root H2 boundaries, ignoring fenced, quoted, and collapsed headings', () => {
    const body = [
      '## Summary',
      '',
      'Visible result.',
      '',
      '```markdown',
      '## Impact',
      '```',
      '',
      '> ## Impact',
      '> Quoted example.',
      '',
      '<details>',
      '<summary>Comparison</summary>',
      '',
      '## Impact',
      'Hidden example.',
      '',
      '</details>',
      '',
      '### Impact',
      'Nested explanation.',
      '',
      '## Impact',
      '',
      'Real audience impact.',
    ].join('\n')
    const document = parseMarkdownSections(body)
    expect(document.sections.map((section) => section.heading)).toEqual(['Summary', 'Impact'])
    expect(document.sections[0]?.content).toContain('Hidden example.')
    expect(document.sections[0]?.endOffset).toBe(body.lastIndexOf('## Impact'))
    expect(validateMarkdownSections(document, policy)).toEqual([])
  })

  it('reports missing, duplicate, and empty required core without requiring optional sections', () => {
    const document = parseMarkdownSections(
      '## Summary\n\n## Summary\n\nResult.\n\n## Other\n\nMore.',
    )
    expect(validateMarkdownSections(document, policy)).toEqual([
      expect.objectContaining({ code: 'duplicate-heading', heading: 'Summary', line: 3 }),
      expect.objectContaining({ code: 'empty-section', heading: 'Summary', line: 1 }),
      expect.objectContaining({ code: 'missing-heading', heading: 'Impact' }),
    ])
    expect(validateMarkdownSections(parseMarkdownSections(''), { requiredHeadings: [] })).toEqual(
      [],
    )
  })

  it('does not count comments, code, labels, images, or collapsed-only content as core', () => {
    for (const content of [
      '<!-- explanation -->',
      '```text\nExplanation.\n```',
      '    Explanation.',
      '<details>\n<summary>Explanation</summary>\n\nHidden explanation.\n\n</details>',
      '![Explanation](https://example.test/image.png)',
      '| Audience | Change |\n| --- | --- |',
      '### Explanation',
      '- <!-- explanation -->',
    ]) {
      const document = parseMarkdownSections(`## Summary\n\n${content}\n\n## Impact\n\nReaders.`)
      expect(validateMarkdownSections(document, policy)).toEqual([
        expect.objectContaining({ code: 'empty-section', heading: 'Summary' }),
      ])
    }
  })

  it('balances nested containers, optional summaries, attributes, and inline tags', () => {
    const body = [
      '## Summary',
      '',
      'Visible <details data-note="<summary> >">',
      '<summary>Hidden label</summary>',
      '',
      '<details>',
      '',
      'Nested hidden.',
      '',
      '</details>',
      '',
      '</details>',
      '',
      '## Impact',
      '',
      'Readers see <span>the updated behavior</span>.',
    ].join('\n')
    expect(validateMarkdownSections(parseMarkdownSections(body), policy)).toEqual([])
    expect(
      validateMarkdownSections(
        parseMarkdownSections(
          '## Summary\n\n<details>\n\nHidden.\n\n</details>\n\n## Impact\n\nReaders.',
        ),
        policy,
      ),
    ).toEqual([expect.objectContaining({ code: 'empty-section', heading: 'Summary' })])
  })

  it('ignores container-looking text in comments and code', () => {
    const body =
      '## Summary\n\nVisible `</details>` example.\n\n<!-- <details><summary> -->\n\n```html\n<details>\n```\n\n## Impact\n\nReaders.'
    expect(validateMarkdownSections(parseMarkdownSections(body), policy)).toEqual([])
  })

  it('does not mistake another HTML tag or its quoted attributes for a disclosure', () => {
    const body =
      '## Summary\n\nResult with <span title="<details>">context</span>.\n\n<details-extra>\n\nMore context.\n\n</details-extra>\n\n## Impact\n\nReaders.'
    expect(validateMarkdownSections(parseMarkdownSections(body), policy)).toEqual([])
  })

  it('cannot expose collapsed-only core through forged disclosure tags in unrelated attributes', () => {
    const body =
      '## Summary\n\n<details>\n<summary>More</summary>\n\n<span title="</details>">Hidden</span>\n\nHidden prose.\n\n<span title="<details>"></span>\n\n</details>\n\n## Impact\n\nReaders.'
    expect(validateMarkdownSections(parseMarkdownSections(body), policy)).toEqual([
      expect.objectContaining({ code: 'empty-section', heading: 'Summary' }),
    ])
  })

  it('tracks inline disclosures in headings without counting their labels as visible prose', () => {
    const document = parseMarkdownSections(
      '## Summary <details>\n\nHidden.\n\n</details>\n\n## Impact\n\nReaders.',
    )
    expect(validateMarkdownSections(document, policy)).toEqual([
      expect.objectContaining({ code: 'empty-section', heading: 'Summary' }),
    ])
  })

  it('does not let hidden inline heading text satisfy a required heading', () => {
    for (const heading of [
      '## <details>Summary</details>',
      '## <details><summary>Label</summary>Summary</details>',
    ]) {
      const document = parseMarkdownSections(`${heading}\n\nResult.\n\n## Impact\n\nReaders.`)
      expect(validateMarkdownSections(document, policy)).toEqual([
        expect.objectContaining({ code: 'missing-heading', heading: 'Summary' }),
      ])
    }
  })

  it('keeps a visible heading name while ignoring its hidden inline suffix', () => {
    const document = parseMarkdownSections(
      '## Summary<details>Extra</details>\n\nResult.\n\n## Impact\n\nReaders.',
    )
    expect(document.sections[0]?.heading).toBe('Summary')
    expect(validateMarkdownSections(document, policy)).toEqual([])
  })

  it('does not truncate issue content at a heading whose entire label is hidden', () => {
    const body =
      '## Related issues\n\n## <details>Hidden</details>\n\nCloses #1\n\n## Impact\n\nReaders.'
    const document = parseMarkdownSections(body)
    expect(document.sections.map((section) => section.heading)).toEqual([
      'Related issues',
      'Impact',
    ])
    expect(document.sections[0]?.content).toBe('\n\n## <details>Hidden</details>\n\nCloses #1\n\n')
  })

  it('normalizes linked heading text without including image alt text in its name', () => {
    const document = parseMarkdownSections(
      '## [Summary](https://example.test) ![icon](https://example.test/icon.png)\n\nResult.\n\n## Impact\n\nReaders.',
    )
    expect(document.sections[0]?.heading).toBe('Summary')
    expect(validateMarkdownSections(document, policy)).toEqual([])
  })

  it.each([
    '<details>\n<summary>Label</summary>',
    '</details>',
    '<summary>Label</summary>',
    '<details><summary>Label</details>',
    '<details></summary></details>',
    '<details><summary>Label<summary>Second</summary></details>',
    '<details><summary>Label</summary><summary>Second</summary></details>',
    '<details/>',
    '<details><summary/></details>',
    '<details><summary>Label<details></details></summary></details>',
  ])('reports malformed container %s with a source line', (container) => {
    const document = parseMarkdownSections(
      `## Summary\n\nResult.\n\n${container}\n\n## Impact\n\nReaders.`,
    )
    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'malformed-details', line: 5 }),
    )
    expect(validateMarkdownSections(document, policy)).toContainEqual(document.diagnostics[0])
  })

  it('does not infer a hidden core heading from an HTML block without Markdown spacing', () => {
    const document = parseMarkdownSections(
      '<details><summary>More</summary>\n## Summary\nHidden.\n</details>\n\n## Impact\n\nReaders.',
    )
    expect(validateMarkdownSections(document, policy)).toEqual([
      expect.objectContaining({ code: 'missing-heading', heading: 'Summary' }),
    ])
  })

  it('supports H2 setext headings and preserves managed journal content verbatim', () => {
    const journal =
      '<details>\n<summary>Shepherd Journal</summary>\n\n## Summary\nAutomation record.\n\n</details>\n'
    const body = `Summary\n-------\n\nResult.\n\nImpact\n------\n\nReaders.\n\n${journal}`
    const document = parseMarkdownSections(body)
    expect(validateMarkdownSections(document, policy)).toEqual([])
    expect(document.sections[1]?.content).toBe(`\n\nReaders.\n\n${journal}`)
  })
})
