import { describe, expect, it } from 'vitest'

import {
  hasUncheckedMarkdownTask,
  markdownHtmlBlocks,
  markdownHtmlFacts,
  markdownLiteralSpans,
} from './index.mts'

describe('Markdown content facts', () => {
  it.each([
    ['prose', 'Just prose', false],
    ['checked task', '- [x] done', false],
    ['uppercase checked task', '- [X] done', false],
    ['unchecked task', '- [ ] remaining', true],
    ['nested task', '  1. [ ] remaining', true],
    ['four-space nested task', '- parent\n    - [ ] remaining', true],
    ['task after continuation prose', '- parent\n\n  prose\n\n  - [ ] remaining', true],
    ['quoted task', '> - [ ] remaining', true],
    ['fenced lookalike', '```md\n- [ ] example\n```', false],
    ['long closing fence', '```md\n- [ ] example\n````\n- [ ] remaining', true],
    ['quoted fenced lookalike', '> ```md\n> - [ ] example\n> ```', false],
    ['indented code', '    - [ ] example', false],
    ['commented lookalike', '<!-- - [ ] hidden -->', false],
    ['unclosed comment', '<!-- hidden\n- [ ] hidden too', false],
    ['escaped HTML lookalike', '&lt;!-- - [ ] visible text', false],
    ['HTML preformatted text', '<pre>\n- [ ] example\n</pre>', false],
  ])('detects unchecked tasks in %s', (_name, markdown, expected) => {
    expect(hasUncheckedMarkdownTask(markdown)).toBe(expected)
  })

  it('finds inline code, fenced code, and HTML as positioned literal spans', () => {
    const markdown = '😀 `inline`\r\n\r\n```txt\r\nblock\r\n```\r\n\r\n<div>raw</div>'
    expect(
      markdownLiteralSpans(markdown).map(({ kind, position, value }) => ({
        kind,
        start: position.start.offset,
        end: position.end.offset,
        value,
      })),
    ).toEqual([
      { kind: 'inline-code', start: 3, end: 11, value: 'inline' },
      { kind: 'code', start: 15, end: 33, value: 'block' },
      { kind: 'html', start: 37, end: 51, value: '<div>raw</div>' },
    ])
  })

  it('preserves line and column coordinates for source-backed spans', () => {
    const markdown = '😀\r\n`code`'
    expect(markdownLiteralSpans(markdown)[0]?.position).toMatchObject({
      start: { offset: 4, line: 2, column: 1 },
      end: { offset: 10, line: 2, column: 7 },
    })
  })

  it('distinguishes inline HTML from block HTML', () => {
    const facts = markdownHtmlFacts('Text <span>inline</span> here.\n\n<div>\nblock\n</div>')
    expect(
      facts
        .filter(({ commonMarkType }) => commonMarkType !== null)
        .map(({ kind, commonMarkType }) => ({
          kind,
          commonMarkType,
        })),
    ).toEqual([{ kind: 'block', commonMarkType: 6 }])
  })

  it('reports CommonMark block types 1, 6, and 7 with their source ranges', () => {
    const markdown = [
      '<script>',
      'raw',
      '</SCRIPT> trailing text',
      '',
      '<div>',
      'block',
      '',
      '<span>',
      'other',
      '',
      'paragraph',
      '<span>inline</span>',
    ].join('\n')
    expect(
      markdownHtmlBlocks(markdown).map(({ commonMarkType, position }) => ({
        commonMarkType,
        startLine: position.start.line,
        endLine: position.end.line,
      })),
    ).toEqual([
      { commonMarkType: 1, startLine: 1, endLine: 3 },
      { commonMarkType: 6, startLine: 5, endLine: 6 },
      { commonMarkType: 7, startLine: 8, endLine: 9 },
    ])
  })

  it('recognizes the full common HTML-block type family', () => {
    const markdown = ['<!-- c -->', '<?pi?>', '<!DOCTYPE html>', '<![CDATA[x]]>'].join('\n\n')
    expect(markdownHtmlFacts(markdown).map(({ commonMarkType }) => commonMarkType)).toEqual([
      2, 3, 4, 5,
    ])
  })

  it('keeps quoted and paragraph-interrupting tags inline when CommonMark does', () => {
    const facts = markdownHtmlFacts('A paragraph\n<span>inline</span>\n\n<div>block</div>')
    expect(
      facts
        .filter(({ commonMarkType }) => commonMarkType !== null)
        .map(({ kind, commonMarkType }) => [kind, commonMarkType]),
    ).toEqual([['block', 6]])
  })

  it('keeps an unclosed type-1 block open through EOF', () => {
    expect(markdownHtmlBlocks('<textarea>\ntext\n\nmore')).toMatchObject([
      { commonMarkType: 1, position: { start: { line: 1 }, end: { line: 4 } } },
    ])
  })

  it('recognizes block HTML inside blockquotes and lists through blank-line boundaries', () => {
    const markdown = '> <div>\n> inside\n>\n> outside\n\n- item\n\n  <span>\n  inside\n'
    expect(
      markdownHtmlBlocks(markdown).map(({ commonMarkType, position }) => ({
        commonMarkType,
        startLine: position.start.line,
        endLine: position.end.line,
      })),
    ).toEqual([
      { commonMarkType: 6, startLine: 1, endLine: 2 },
      { commonMarkType: 7, startLine: 8, endLine: 9 },
    ])
  })

  it('keeps type-6 and type-7 blocks bounded at the next blank line and at EOF', () => {
    expect(markdownHtmlBlocks('<div>\ninside\n\noutside')).toMatchObject([
      { commonMarkType: 6, position: { start: { line: 1 }, end: { line: 2 } } },
    ])
    expect(markdownHtmlBlocks('<span>\ninside')).toMatchObject([
      { commonMarkType: 7, position: { start: { line: 1 }, end: { line: 2 } } },
    ])
  })
})
