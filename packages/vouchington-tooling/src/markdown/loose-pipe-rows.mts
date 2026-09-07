import type { Position } from 'unist'

import type { LooseMarkdownTableRow, LooseMarkdownTableRowsOptions } from './types.mts'

export function extractLooseMarkdownTableRows(
  markdown: string,
  options: LooseMarkdownTableRowsOptions = {},
): LooseMarkdownTableRow[] {
  const rows: LooseMarkdownTableRow[] = []
  let offset = 0
  for (const [index, line] of markdown.split('\n').entries()) {
    if (!isExcluded(offset, offset + line.length, options.excludePositions)) {
      const cells = parseLoosePipeRow(line)
      if (cells.length > 0) rows.push({ cells, line: index + 1, offset })
    }
    offset += line.length + 1
  }
  return rows
}

function isExcluded(
  lineStart: number,
  lineEnd: number,
  positions: readonly Position[] | undefined,
): boolean {
  return (
    positions?.some((position) => {
      const start = position.start.offset
      const end = position.end.offset
      return start !== undefined && end !== undefined && lineStart < end && lineEnd > start
    }) ?? false
  )
}

function parseLoosePipeRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return []
  const row = trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed.slice(1)
  const cells = row
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean)
  return cells.every((cell) => /^:?-{3,}:?$/u.test(cell)) ? [] : cells
}
