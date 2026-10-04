import { parseGfmMarkdown, walkMarkdown } from './ast.mts'
import type { MarkdownSourceSpan } from './types.mts'

/**
 * Returns source spans for fenced/indented code, inline code, and raw HTML. Offsets are JavaScript
 * string offsets; positions retain the parser's 1-indexed line and column coordinates.
 */
export function markdownLiteralSpans(markdown: string): MarkdownSourceSpan[] {
  const spans: MarkdownSourceSpan[] = []
  walkMarkdown(parseGfmMarkdown(markdown), (node) => {
    if (node.type !== 'code' && node.type !== 'inlineCode' && node.type !== 'html') return
    if (!node.position) return
    spans.push({
      kind: node.type === 'inlineCode' ? 'inline-code' : node.type,
      position: node.position,
      value: node.value,
    })
  })
  return spans
}
