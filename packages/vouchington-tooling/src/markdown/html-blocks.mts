import { parseGfmMarkdown } from './ast.mts'
import type { MarkdownHtmlBlockType, MarkdownHtmlFact, MarkdownNode } from './types.mts'

const BLOCK_CONTAINERS = new Set(['root', 'blockquote', 'list', 'listItem'])
const TYPE1 = /^ {0,3}<(script|style|pre|textarea)(?:[\s>]|$)/i
const TYPE6_NAMES =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|' +
  'dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|' +
  'hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|' +
  'section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul'
const TYPE6 = new RegExp(`^ {0,3}</?(?:${TYPE6_NAMES})(?:[\\s>]|/>|$)`, 'i')
const TAG = /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:[\s>]|\/>|$)/

function htmlType(value: string): MarkdownHtmlBlockType | null {
  if (TYPE1.test(value)) return 1
  if (/^ {0,3}<!--/.test(value)) return 2
  if (/^ {0,3}<\?/.test(value)) return 3
  if (/^ {0,3}<![A-Za-z]/.test(value)) return 4
  if (/^ {0,3}<!\[CDATA\[/i.test(value)) return 5
  if (TYPE6.test(value)) return 6
  if (TAG.test(value)) return 7
  return null
}

/** Returns source-backed HTML facts, classifying inline occurrences separately from block nodes. */
export function markdownHtmlFacts(markdown: string): MarkdownHtmlFact[] {
  const facts: MarkdownHtmlFact[] = []
  const visit = (node: MarkdownNode, inBlockContainer: boolean): void => {
    if (node.type === 'html' && node.position) {
      const kind = inBlockContainer ? 'block' : 'inline'
      facts.push({
        kind,
        commonMarkType: kind === 'block' ? htmlType(node.value) : null,
        position: node.position,
        value: node.value,
      })
    }
    if (!('children' in node)) return
    const childIsBlockContainer = BLOCK_CONTAINERS.has(node.type)
    for (const child of node.children) visit(child, childIsBlockContainer)
  }
  visit(parseGfmMarkdown(markdown), true)
  return facts
}

/** Returns block HTML facts for CommonMark types 1, 6, and 7, preserving their parser bounds. */
export function markdownHtmlBlocks(markdown: string): MarkdownHtmlFact[] {
  return markdownHtmlFacts(markdown).filter(
    (fact) =>
      fact.kind === 'block' &&
      (fact.commonMarkType === 1 || fact.commonMarkType === 6 || fact.commonMarkType === 7),
  )
}
