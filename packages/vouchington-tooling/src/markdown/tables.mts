import type { Table } from 'mdast'

import { findMarkdownNodes, parseGfmMarkdown } from './ast.mts'
import { markdownNodeText } from './text.mts'
import type {
  MarkdownNode,
  MarkdownTableRow,
  MarkdownTextOptions,
  ParseMarkdownTablesOptions,
  PositionedMarkdownTable,
} from './types.mts'

export function extractMarkdownTables(root: MarkdownNode): PositionedMarkdownTable[] {
  return findMarkdownNodes(root, (node): node is Table => node.type === 'table').map((table) => {
    const result: PositionedMarkdownTable = {
      rows: normalizeTableRows(table),
    }
    if (table.position) result.position = table.position
    return result
  })
}

export function parseMarkdownTables(
  markdown: string,
  options: ParseMarkdownTablesOptions = {},
): MarkdownTableRow[][] {
  const root = parseGfmMarkdown(normalizeTableDelimiterRows(markdown))
  return findMarkdownNodes(root, (node): node is Table => node.type === 'table').map((table) =>
    normalizeTableRows(table, {
      inlineCode: options.preserveInlineCodeMarkers ? 'markers' : 'content',
      issueReferences: 'brackets',
    }),
  )
}

function normalizeTableRows(
  table: Table,
  textOptions: MarkdownTextOptions = {},
): MarkdownTableRow[] {
  return table.children.map((row) => ({
    cells: row.children.map((cell) => markdownNodeText(cell, textOptions).trim()),
    line: row.position?.start.line ?? 1,
  }))
}

function normalizeTableDelimiterRows(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('|')) return line
      const cells = trimmed
        .replace(/^\|/u, '')
        .replace(/\|$/u, '')
        .split('|')
        .map((cell) => cell.trim())
      if (!cells.every((cell) => /^:?-+:?$/u.test(cell))) return line
      return `| ${cells.map((cell) => cell.replace(/-+/u, '---')).join(' | ')} |`
    })
    .join('\n')
}
