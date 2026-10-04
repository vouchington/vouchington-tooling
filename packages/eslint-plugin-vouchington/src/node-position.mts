import { type NodeLike } from './ast-helpers.mts'

/** Supports the range and start/end position shapes supplied by AST adapters. */
export function nodePosition(node: NodeLike, end: boolean): number {
  const range = node.range as number[] | undefined
  return range?.[end ? 1 : 0] ?? Number(node[end ? 'end' : 'start'])
}
