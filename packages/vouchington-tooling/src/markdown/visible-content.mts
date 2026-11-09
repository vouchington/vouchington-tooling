import { parseGfmMarkdown } from './ast.mts'
import { DetailsScope } from './details-scope.mts'
import type { MarkdownNode, MarkdownSourcePosition } from './types.mts'
import type { MarkdownVisibleBlock, MarkdownVisibleContent } from './visible-content-types.mts'

const normalized = (value: string): string => value.replace(/\s+/gu, ' ').trim()
const positionOf = (node: MarkdownNode): MarkdownSourcePosition =>
  node.position as MarkdownSourcePosition

/** Parses source-positioned, visible Markdown facts without interpreting prose semantics. */
export function parseVisibleMarkdownContent(markdown: string): MarkdownVisibleContent {
  const blocks: MarkdownVisibleBlock[] = []
  const scope = new DetailsScope(markdown)

  const acceptHtml = (node: Extract<MarkdownNode, { type: 'html' }>, block: boolean): void => {
    const fragments: string[] = []
    scope.acceptHtml(node.value, node.position!.start.offset!, (value) => fragments.push(value))
    // Raw HTML may render text that the Markdown AST cannot measure. Surface it for callers to
    // reject in governed sections; inline tags retain their adjacent AST text nodes instead.
    if (fragments.length)
      blocks.push({
        kind: 'raw-html',
        block,
        value: fragments.join(''),
        position: positionOf(node),
      })
  }

  const inlineText = (node: MarkdownNode): string => {
    if (node.type === 'html') {
      acceptHtml(node, false)
      return ''
    }
    if (node.type === 'image' || node.type === 'imageReference' || node.type === 'inlineCode')
      return ''
    if (node.type === 'text') return scope.visible ? node.value : ''
    if (node.type === 'break') return scope.visible ? ' ' : ''
    if (!('children' in node)) return ''
    return node.children.map(inlineText).join('')
  }

  const visit = (node: MarkdownNode, ordered = false): void => {
    if (node.type === 'html') {
      acceptHtml(node, true)
      return
    }
    if (node.type === 'code') {
      const offset = node.position?.start.offset ?? 0
      if (scope.visible && /^(?:`{3,}|~{3,})/u.test(markdown.slice(offset))) {
        blocks.push({
          kind: 'fenced-code',
          language: node.lang ?? null,
          value: node.value,
          position: positionOf(node),
        })
      }
      return
    }
    if (node.type === 'heading' || node.type === 'paragraph') {
      const text = normalized(node.children.map(inlineText).join(''))
      if (text) {
        if (node.type === 'heading')
          blocks.push({ kind: 'heading', depth: node.depth, text, position: positionOf(node) })
        else blocks.push({ kind: 'paragraph', text, position: positionOf(node) })
      }
      return
    }
    if (node.type === 'listItem') {
      const pieces: string[] = []
      for (const child of node.children) {
        if (child.type === 'paragraph') pieces.push(inlineText(child))
        else visit(child)
      }
      const text = normalized(pieces.join(' '))
      if (text) blocks.push({ kind: 'list-item', ordered, text, position: positionOf(node) })
      return
    }
    if (node.type === 'list') {
      for (const child of node.children) visit(child, node.ordered === true)
      return
    }
    if (node.type === 'table') {
      const rows = node.children.map((row) => ({
        cells: row.children.map((cell) => normalized(inlineText(cell))),
        position: positionOf(row),
      }))
      if (rows.some((row) => row.cells.some(Boolean))) {
        blocks.push({
          kind: 'table',
          headers: rows[0]?.cells ?? [],
          rows: rows.slice(1),
          position: positionOf(node),
        })
      }
      return
    }
    if (!('children' in node)) return
    for (const child of node.children) visit(child)
  }

  visit(parseGfmMarkdown(markdown))
  scope.finish()
  blocks.sort((a, b) => a.position.start.offset - b.position.start.offset)
  const text = blocks
    .flatMap((block) => {
      if (block.kind === 'table')
        return [...block.headers, ...block.rows.flatMap((row) => row.cells)]
      return 'text' in block ? [block.text] : []
    })
    .filter(Boolean)
    .join('\n')
  return { text, blocks, diagnostics: scope.diagnostics }
}
