import { describe, expect, it } from 'vitest'

import { parseVisibleMarkdownContent } from './index.mts'

describe('visible Markdown content', () => {
  it('returns ordered prose, table cells, and positioned Mermaid without counting code or images', () => {
    const markdown = [
      '## Summary',
      '',
      'A **visible** result with `hidden code` and ![hidden alt](image.png).',
      '',
      '- First reason',
      '- Second [reason](https://example.test)',
      '',
      '| Before | After |',
      '| --- | --- |',
      '| Slow | Fast |',
      '',
      '```mermaid',
      'flowchart LR',
      'A --> B',
      '```',
      '',
      '<!-- hidden comment -->',
    ].join('\n')
    const result = parseVisibleMarkdownContent(markdown)
    expect(result.text).toBe(
      'Summary\nA visible result with and .\nFirst reason\nSecond reason\nBefore\nAfter\nSlow\nFast',
    )
    expect(result.blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'list-item',
      'list-item',
      'table',
      'fenced-code',
    ])
    expect(result.blocks[4]).toMatchObject({
      headers: ['Before', 'After'],
      rows: [{ cells: ['Slow', 'Fast'], position: { start: { line: 10 } } }],
    })
    expect(result.blocks[5]).toMatchObject({
      language: 'mermaid',
      value: 'flowchart LR\nA --> B',
      position: { start: { line: 12 } },
    })
    expect(result.diagnostics).toEqual([])
  })

  it('excludes open and nested disclosures, including their tables and code fences', () => {
    const markdown = [
      'Outside.',
      '',
      '<details open>',
      '<summary>Hidden label</summary>',
      '',
      'Hidden prose.',
      '',
      '<details>',
      '',
      '| Before | After |',
      '| --- | --- |',
      '| Old | New |',
      '',
      '```mermaid',
      'hidden graph',
      '```',
      '',
      '</details>',
      '</details>',
      '',
      'Visible again.',
    ].join('\n')
    const result = parseVisibleMarkdownContent(markdown)
    expect(result.text).toBe('Outside.\nVisible again.')
    expect(result.blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph'])
    expect(result.diagnostics).toEqual([])
  })

  it('does not treat code, comments, images, or tag lookalikes as disclosures', () => {
    const markdown = [
      'Visible `</details>` and ![<details>](image.png).',
      '',
      '<!-- <details><summary>Hidden</summary> -->',
      '',
      '```html',
      '<details>Not a disclosure</details>',
      '```',
      '',
      '<span title="<details>">Still visible</span>.',
      '',
      '    ```mermaid',
    ].join('\n')
    const result = parseVisibleMarkdownContent(markdown)
    expect(result.text).toBe('Visible and .\nStill visible.')
    expect(result.blocks.filter((block) => block.kind === 'fenced-code')).toMatchObject([
      { language: 'html' },
    ])
    expect(result.diagnostics).toEqual([])
  })

  it('surfaces unmeasured raw HTML blocks while counting tagged inline prose once', () => {
    const markdown =
      'A <strong>measured</strong> phrase.\n\n<div>Huge rendered text</div>\n\nAfter.'
    const result = parseVisibleMarkdownContent(markdown)
    expect(result.text).toBe('A measured phrase.\nAfter.')
    expect(result.blocks.filter((block) => block.kind === 'raw-html')).toEqual([
      expect.objectContaining({ block: false, value: '<strong>' }),
      expect.objectContaining({ block: false, value: '</strong>' }),
      expect.objectContaining({ block: true, value: '<div>Huge rendered text</div>' }),
    ])
  })

  it('surfaces visible HTML after a disclosure closes in the same HTML node', () => {
    for (const markdown of [
      'Visible.\n\n<details>\nHidden\n</details>\n<div>Huge visible content</div>',
      'Visible.\n\n<details>\n\nHidden.\n\n</details>\n<div>Huge visible content</div>',
    ]) {
      const result = parseVisibleMarkdownContent(markdown)
      expect(result.text).toBe('Visible.')
      expect(result.blocks.filter((block) => block.kind === 'raw-html')).toEqual([
        expect.objectContaining({
          block: true,
          value: '<div>Huge visible content</div>',
        }),
      ])
      expect(result.diagnostics).toEqual([])
    }
  })

  it('retains Unicode and CRLF source positions and reports malformed disclosures', () => {
    const markdown = '😀 intro\r\n\r\n## Why\r\n\r\n- A reason\r\n\r\n</details>'
    const result = parseVisibleMarkdownContent(markdown)
    expect(result.blocks[1]).toMatchObject({
      kind: 'heading',
      text: 'Why',
      position: { start: { line: 3, offset: markdown.indexOf('## Why') } },
    })
    expect(result.blocks[2]).toMatchObject({ kind: 'list-item', ordered: false, text: 'A reason' })
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'malformed-details', line: 7 }),
    ])
  })

  it('does not duplicate nested list prose', () => {
    const result = parseVisibleMarkdownContent('- Parent\n  1. Child\n- Sibling')
    expect(result.blocks.map((block) => block.kind)).toEqual([
      'list-item',
      'list-item',
      'list-item',
    ])
    expect(result.text).toBe('Parent\nChild\nSibling')
    expect(result.blocks.map((block) => block.kind === 'list-item' && block.ordered)).toEqual([
      false,
      true,
      false,
    ])
  })

  it('measures hard breaks, footnote references, unlabelled fences and leaf blocks', () => {
    const markdown = [
      'Line one  ',
      'line two[^1]',
      '',
      '***',
      '',
      '-',
      '',
      '# ![only an image](i.png)',
      '',
      '~~~',
      'plain',
      '~~~',
      '',
      '[^1]: Footnote prose',
    ].join('\n')
    const result = parseVisibleMarkdownContent(markdown)
    expect(result.text).toBe('Line one line two\nFootnote prose')
    expect(result.blocks).toEqual([
      expect.objectContaining({ kind: 'paragraph', text: 'Line one line two' }),
      expect.objectContaining({ kind: 'fenced-code', language: null, value: 'plain' }),
      expect.objectContaining({ kind: 'paragraph', text: 'Footnote prose' }),
    ])
  })

  it('drops hard breaks inside a disclosure', () => {
    const result = parseVisibleMarkdownContent(
      '<details>\n<summary>More</summary>\n\nHidden  \nbreak\n\n</details>\n\nShown',
    )
    expect(result.text).toBe('Shown')
  })
})
