import { parseGfmMarkdown } from './ast.mts'
import { DetailsScope } from './details-scope.mts'
import type { MarkdownSectionsDocument, MarkdownVisibleSection } from './document-types.mts'
import type { MarkdownNode } from './types.mts'

/** Parses visible root H2 sections while retaining exact source ranges and disclosure scope. */
export function parseMarkdownSections(markdown: string): MarkdownSectionsDocument {
  const sections: MarkdownVisibleSection[] = []
  const scope = new DetailsScope(markdown)
  let current: MarkdownVisibleSection | undefined

  const visit = (node: MarkdownNode, collectText: boolean): void => {
    if (node.type === 'html') {
      scope.acceptHtml(node.value, node.position!.start.offset!)
      return
    }
    if (node.type === 'code' || node.type === 'image') return
    if (
      collectText &&
      scope.visible &&
      current &&
      (node.type === 'text' || node.type === 'inlineCode') &&
      node.value.trim()
    ) {
      current.hasVisibleContent = true
    }
    if (!('children' in node)) return
    for (const [index, child] of node.children.entries()) {
      visit(child, collectText && node.type !== 'heading' && (node.type !== 'table' || index > 0))
    }
  }

  for (const node of parseGfmMarkdown(markdown).children) {
    if (node.type === 'heading') {
      const wasVisible = scope.visible
      const heading = headingText(node, scope).replace(/\s+/gu, ' ').trim()
      if (node.depth === 2 && wasVisible && heading) {
        if (current) current.endOffset = node.position!.start.offset!
        current = {
          heading,
          content: '',
          startOffset: node.position!.end.offset!,
          endOffset: markdown.length,
          line: node.position!.start.line,
          hasVisibleContent: false,
        }
        sections.push(current)
      }
      continue
    }
    visit(node, node.type === 'paragraph' || node.type === 'list' || node.type === 'table')
  }
  scope.finish()
  for (const section of sections)
    section.content = markdown.slice(section.startOffset, section.endOffset)
  return { sections, diagnostics: scope.diagnostics }
}

function headingText(node: MarkdownNode, scope: DetailsScope): string {
  if (node.type === 'html') {
    scope.acceptHtml(node.value, node.position!.start.offset!)
    return ''
  }
  if (node.type === 'text' || node.type === 'inlineCode') return scope.visible ? node.value : ''
  if (!('children' in node)) return ''
  return node.children.map((child) => headingText(child, scope)).join('')
}
