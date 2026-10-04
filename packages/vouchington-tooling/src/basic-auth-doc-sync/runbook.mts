import { parseGfmMarkdown } from '../markdown/ast.mts'
import { markdownNodeText } from '../markdown/text.mts'
import { parseMarkdownTables } from '../markdown/tables.mts'
import { isCanonicalHttpMethod } from './methods.mts'

const METHODS_CELL_RE = /^`[^`]+`(?:\s*,\s*`[^`]+`)*$/

export type ExemptRoute = {
  methods: string[]
  path: string
}

function codeText(cell: string): string | null {
  const match = /^`([^`]+)`$/.exec(cell)
  return match?.[1] ?? null
}

function methodTexts(cell: string): string[] | null {
  if (!METHODS_CELL_RE.test(cell)) return null
  const methods = Array.from(cell.matchAll(/`([^`]+)`/g), (match) => match[1]).filter(
    (value): value is string => value !== undefined,
  )
  return methods.every(isCanonicalHttpMethod) ? methods : null
}

function tableHeaderColumns(cells: string[]): Map<string, number> | null {
  const columns = new Map<string, number>()
  for (const [index, cell] of cells.entries()) {
    const name = cell.toLowerCase()
    if ((name === 'path' || name === 'methods') && columns.has(name)) return null
    columns.set(name, index)
  }
  return columns
}

export function findRunbookExemptRoutes(markdown: string, heading: string): ExemptRoute[] | null {
  const children = parseGfmMarkdown(markdown).children
  const headingIndex = children.findIndex(
    (node) =>
      node.type === 'heading' &&
      node.depth === 3 &&
      markdownNodeText(node, { whitespace: 'collapse' }).toLowerCase() === heading.toLowerCase(),
  )
  if (headingIndex === -1) return null
  const endIndex = children.findIndex(
    (node, index) => index > headingIndex && node.type === 'heading' && node.depth <= 3,
  )
  const startOffset = children[headingIndex]!.position!.end.offset!
  const endOffset = endIndex === -1 ? markdown.length : children[endIndex]!.position!.start.offset!
  const table = parseMarkdownTables(markdown.slice(startOffset, endOffset), {
    preserveInlineCodeMarkers: true,
  })[0]
  if (!table || table.length < 2) return null

  const routes: ExemptRoute[] = []
  const columns = tableHeaderColumns(table[0]!.cells)
  if (!columns) return null
  const pathColumn = columns.get('path') ?? -1
  const methodsColumn = columns.get('methods') ?? -1
  if (pathColumn === -1 || methodsColumn === -1) return null

  for (const row of table.slice(1)) {
    const path = codeText(row.cells[pathColumn] ?? '')
    const methods = methodTexts(row.cells[methodsColumn] ?? '')
    if (!path) return null
    if (!methods || methods.length === 0) return null
    routes.push({ methods, path })
  }

  return routes
}
