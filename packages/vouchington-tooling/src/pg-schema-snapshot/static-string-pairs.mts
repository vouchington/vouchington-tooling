import { isNode, parseSource, walk } from '../post-publication-inventory/readers/source-ast.mts'

/**
 * Collects the first two string literals of every source array in ESTree field traversal order.
 * Order follows the existing parser walker, including conditional alternatives before consequents.
 * Arrays may contain further elements. This does not evaluate constants, imports, or spreads;
 * repeated pairs remain repeated so callers can apply their own selection and deduplication.
 * Invalid source throws through the source-only parser.
 */
export function extractStaticStringPairs(source: string): readonly (readonly [string, string])[] {
  const pairs: [string, string][] = []
  const { ast } = parseSource(source)
  walk(ast, (node) => {
    if (node.type !== 'ArrayExpression' || !Array.isArray(node.elements)) return
    const [first, second] = node.elements
    if (
      isNode(first) &&
      isNode(second) &&
      first.type === 'Literal' &&
      second.type === 'Literal' &&
      typeof first.value === 'string' &&
      typeof second.value === 'string'
    ) {
      pairs.push([first.value, second.value])
    }
  })
  return pairs
}
