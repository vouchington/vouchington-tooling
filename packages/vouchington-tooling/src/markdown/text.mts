import type { MarkdownNode, MarkdownTextOptions } from './types.mts'

export function markdownNodeText(node: MarkdownNode, options: MarkdownTextOptions = {}): string {
  const text = textFor(node, options)
  return options.whitespace === 'collapse' ? text.replace(/\s+/gu, ' ').trim() : text
}

function textFor(node: MarkdownNode, options: MarkdownTextOptions): string {
  if (node.type === 'break') return ' '
  if ('value' in node && typeof node.value === 'string') {
    if (node.type === 'inlineCode' && options.inlineCode === 'markers') return `\`${node.value}\``
    return node.value
  }
  if (!('children' in node)) return ''
  const text = node.children.map((child) => textFor(child, options)).join('')
  if (
    options.issueReferences === 'brackets' &&
    (node.type === 'link' || node.type === 'linkReference') &&
    /^#\d+$/u.test(text.trim())
  ) {
    return `[${text.trim()}]`
  }
  return text
}
