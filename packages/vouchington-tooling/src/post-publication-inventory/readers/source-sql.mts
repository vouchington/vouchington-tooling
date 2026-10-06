import { isNode, propertyName, type UnknownNode as Node } from './source-ast.mts'
import type { ReaderSourceAnalysisOptions } from './source-options.mts'

export function collectEligibleImports(
  node: Node,
  source: string,
  symbols: string[],
  imported: Set<string>,
  options: ReaderSourceAnalysisOptions,
): void {
  if (!Array.isArray(node.specifiers)) return
  for (const specifier of node.specifiers) {
    if (!isNode(specifier) || specifier.type !== 'ImportSpecifier') continue
    const importedName = propertyName(specifier.imported as Node)
    const localName = propertyName(specifier.local as Node)
    if (
      importedName &&
      localName &&
      symbols.includes(importedName) &&
      options.canonicalImports.get(importedName)?.has(source)
    ) {
      imported.add(localName)
    }
  }
}
