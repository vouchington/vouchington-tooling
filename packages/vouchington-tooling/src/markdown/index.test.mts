import { readFile } from 'node:fs/promises'

import type { Heading } from 'mdast'
import { describe, expect, it } from 'vitest'

import {
  extractLooseMarkdownTableRows,
  extractMarkdownTables,
  findMarkdownNode,
  findMarkdownNodes,
  markdownNodeText,
  markdownSectionBetweenHeadings,
  parseGfmMarkdown,
  parseMarkdownTables,
  walkMarkdown,
} from './index.mts'

describe('markdown', () => {
  it('parses and walks GFM Markdown in pre-order', () => {
    const root = parseGfmMarkdown('# Title\n\nText with [#12](https://example.test).')
    const visited: string[] = []
    walkMarkdown(root, (node) => visited.push(node.type))
    expect(visited).toEqual([
      'root',
      'heading',
      'text',
      'paragraph',
      'text',
      'link',
      'text',
      'text',
    ])
    const heading = findMarkdownNode(root, (node): node is Heading => node.type === 'heading')
    expect(heading?.depth).toBe(1)
    expect(findMarkdownNodes(root, (node) => node.type === 'text')).toHaveLength(4)
  })

  it('normalizes Markdown node text with configurable code, references, and whitespace', () => {
    const root = parseGfmMarkdown('A  **bold**\\\n`code` [#7](https://example.test)')
    expect(markdownNodeText(root)).toBe('A  bold code #7')
    expect(
      markdownNodeText(root, {
        whitespace: 'collapse',
        inlineCode: 'markers',
        issueReferences: 'brackets',
      }),
    ).toBe('A bold `code` [#7]')
  })

  it('flattens emphasis and reference-style issue links', () => {
    const root = parseGfmMarkdown(
      '**strong _emphasis_** [#17][issue]\n\n[issue]: https://example.test',
    )
    expect(markdownNodeText(root)).toBe('strong emphasis #17')
    expect(markdownNodeText(root, { issueReferences: 'brackets' })).toBe('strong emphasis [#17]')
  })

  it('extracts positioned GFM tables and preserves the compatibility table API', () => {
    const markdown = '| Key | Value |\n| - | :--: |\n| `a` | [#9](https://example.test) |'
    const root = parseGfmMarkdown(markdown)
    const tables = extractMarkdownTables(root)
    expect(tables).toHaveLength(1)
    expect(tables[0]?.position?.start.offset).toBe(0)
    expect(tables[0]?.rows[1]).toEqual({ cells: ['a', '#9'], line: 3 })
    expect(parseMarkdownTables(markdown, { preserveInlineCodeMarkers: true })).toEqual([
      [
        { cells: ['Key', 'Value'], line: 1 },
        { cells: ['`a`', '[#9]'], line: 3 },
      ],
    ])
  })

  it('preserves raw positions and GFM escaped pipes in positioned tables', () => {
    const markdown = '😀\n\n| A | B |\n| --- | --- |\n| left\\|right | value |'
    const table = extractMarkdownTables(parseGfmMarkdown(markdown))[0]
    expect(table?.position?.start).toMatchObject({ line: 3, column: 1, offset: 4 })
    expect(table?.rows[1]).toEqual({ cells: ['left|right', 'value'], line: 5 })
  })

  it('keeps positionless caller-supplied AST tables usable', () => {
    const root = {
      type: 'root',
      children: [
        {
          type: 'table',
          children: [
            {
              type: 'tableRow',
              children: [{ type: 'tableCell', children: [{ type: 'text', value: 'value' }] }],
            },
          ],
        },
      ],
    } as unknown as ReturnType<typeof parseGfmMarkdown>
    expect(extractMarkdownTables(root)).toEqual([{ rows: [{ cells: ['value'], line: 1 }] }])
  })

  it('supports tables without trailing pipes and rejects malformed or empty input', () => {
    expect(parseMarkdownTables('| A | B\n| --- | ---\n| one | two')).toEqual([
      [
        { cells: ['A', 'B'], line: 1 },
        { cells: ['one', 'two'], line: 3 },
      ],
    ])
    expect(parseMarkdownTables('| only | cells |')).toEqual([])
    expect(parseMarkdownTables('')).toEqual([])
  })

  it('returns exact heading sections with configurable end boundaries', () => {
    const markdown = '## Start\n😀 body\n### End\ninner\n## End\noutside\n\n`## End`'
    expect(markdownSectionBetweenHeadings(markdown, 'Start', 'End')).toMatchObject({
      content: '\n😀 body\n### End\ninner\n',
      startOffset: 8,
      endOffset: 31,
    })
    expect(
      markdownSectionBetweenHeadings(markdown, 'Start', 'End', { endBoundary: 'any' }),
    ).toMatchObject({
      content: '\n😀 body\n',
      startOffset: 8,
      endOffset: 17,
    })
    expect(markdownSectionBetweenHeadings(markdown, 'Missing', 'End')).toBeNull()
  })

  it('uses real headings, first duplicates, setext headings, and EOF when no end exists', () => {
    const duplicates = '`## Start`\n\n## Start\nfirst\n## End\nignored\n## Start\nsecond\n## End'
    expect(markdownSectionBetweenHeadings(duplicates, 'Start', 'End')?.content).toBe('\nfirst\n')
    expect(markdownSectionBetweenHeadings('## Start\nrest', 'Start', 'End')?.content).toBe('\nrest')
    expect(
      markdownSectionBetweenHeadings('Start\n=====\nbody\n\nEnd\n=====\n', 'Start', 'End')?.content,
    ).toBe('\nbody\n\n')
  })

  it('recovers loose pipe rows outside parsed table positions', () => {
    const markdown =
      '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nLoose rows:\n| loose | row |\n| --- | --- |\n| last | cell'
    const parsedTableEnd = markdown.indexOf('\n\n')
    expect(
      extractLooseMarkdownTableRows(markdown, {
        excludePositions: [
          {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 3, column: 10, offset: parsedTableEnd },
          },
        ],
      }),
    ).toEqual([
      { cells: ['loose', 'row'], line: 6, offset: 47 },
      { cells: ['last', 'cell'], line: 8, offset: 77 },
    ])
  })

  it('keeps loose-row recovery literal for delimiters, empty cells, and missing trailing pipes', () => {
    const markdown = '| loose | row\n| :---: | --- |\n| first | | third'
    expect(extractLooseMarkdownTableRows(markdown)).toEqual([
      { cells: ['loose', 'row'], line: 1, offset: 0 },
      { cells: ['first', 'third'], line: 3, offset: markdown.indexOf('| first') },
    ])
  })

  it('does not re-emit indented parsed tables when their positions begin after a line start', () => {
    const markdown = '   | A | B |\n   | --- | --- |\n   | 1 | 2 |'
    const positions = extractMarkdownTables(parseGfmMarkdown(markdown)).flatMap((table) =>
      table.position ? [table.position] : [],
    )
    expect(extractLooseMarkdownTableRows(markdown, { excludePositions: positions })).toEqual([])
  })

  it('publishes the built markdown subpath contract', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      exports: Record<string, unknown>
    }
    expect(manifest.exports['./markdown']).toEqual({
      default: './dist/markdown/index.mjs',
      import: './dist/markdown/index.mjs',
      types: './dist/markdown/index.d.mts',
    })
  })
})
