import type { Heading, RootContent } from 'mdast'

import { parseGfmMarkdown } from './ast.mts'
import { markdownNodeText } from './text.mts'
import type { MarkdownSection, MarkdownSectionOptions } from './types.mts'

export function markdownSectionBetweenHeadings(
  markdown: string,
  start: string,
  end: string,
  options: MarkdownSectionOptions = {},
): MarkdownSection | null {
  const children = parseGfmMarkdown(markdown).children
  const startIndex = children.findIndex((node) => isNamedHeading(node, start))
  if (startIndex < 0) return null
  const startHeading = children[startIndex] as Heading
  const endIndex = children.findIndex(
    (node, index) =>
      index > startIndex &&
      isNamedHeading(node, end) &&
      (options.endBoundary === 'any' || node.depth <= startHeading.depth),
  )
  const endHeading: Heading | null = endIndex < 0 ? null : (children[endIndex]! as Heading)
  const startOffset = startHeading.position!.end.offset!
  const endOffset = endHeading ? endHeading.position!.start.offset! : markdown.length
  return {
    content: markdown.slice(startOffset, endOffset),
    endHeading,
    endOffset,
    startHeading,
    startOffset,
  }
}

function isNamedHeading(node: RootContent, expected: string): node is Heading {
  return node.type === 'heading' && markdownNodeText(node, { whitespace: 'collapse' }) === expected
}
