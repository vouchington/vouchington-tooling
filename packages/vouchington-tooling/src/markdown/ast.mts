import { remark } from 'remark'
import remarkGfm from 'remark-gfm'

import type { Root } from 'mdast'

import type { MarkdownNode } from './types.mts'

const processor = remark().use(remarkGfm)

export function parseGfmMarkdown(markdown: string): Root {
  return processor.parse(markdown) as Root
}

export function walkMarkdown(node: MarkdownNode, visitor: (node: MarkdownNode) => void): void {
  visitor(node)
  if (!('children' in node)) return
  for (const child of node.children) walkMarkdown(child, visitor)
}

export function findMarkdownNode<T extends MarkdownNode>(
  node: MarkdownNode,
  predicate: (node: MarkdownNode) => node is T,
): T | null
export function findMarkdownNode(
  node: MarkdownNode,
  predicate: (node: MarkdownNode) => boolean,
): MarkdownNode | null
export function findMarkdownNode(
  node: MarkdownNode,
  predicate: (node: MarkdownNode) => boolean,
): MarkdownNode | null {
  let match: MarkdownNode | null = null
  walkMarkdown(node, (candidate) => {
    if (!match && predicate(candidate)) match = candidate
  })
  return match
}

export function findMarkdownNodes<T extends MarkdownNode>(
  node: MarkdownNode,
  predicate: (node: MarkdownNode) => node is T,
): T[]
export function findMarkdownNodes(
  node: MarkdownNode,
  predicate: (node: MarkdownNode) => boolean,
): MarkdownNode[]
export function findMarkdownNodes(
  node: MarkdownNode,
  predicate: (node: MarkdownNode) => boolean,
): MarkdownNode[] {
  const matches: MarkdownNode[] = []
  walkMarkdown(node, (candidate) => {
    if (predicate(candidate)) matches.push(candidate)
  })
  return matches
}
