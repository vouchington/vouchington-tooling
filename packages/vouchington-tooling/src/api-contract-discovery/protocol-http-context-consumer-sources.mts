import ts from '../contract-schema/typescript-api.mts'

/** The discovery's actual Program bounds transitive module consumers; no process cache is used. */
export function createContextConsumerSources(
  checker: ts.TypeChecker,
  sources?: readonly ts.SourceFile[],
) {
  const consumers = new Map<ts.SourceFile, Set<ts.SourceFile>>()
  const cache = new Map<ts.SourceFile, readonly ts.SourceFile[]>()
  let indexed = false
  function ensureIndex() {
    if (indexed) return
    indexed = true
    for (const source of sources ?? []) {
      function index(node: ts.Node) {
        const specifier =
          ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
            ? node.moduleSpecifier
            : ts.isImportEqualsDeclaration(node) &&
                ts.isExternalModuleReference(node.moduleReference)
              ? node.moduleReference.expression
              : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
                ? node.arguments[0]
                : undefined
        const module = specifier && checker.getSymbolAtLocation(specifier)
        for (const declaration of module?.declarations ?? []) {
          if (!ts.isSourceFile(declaration)) continue
          const rows = consumers.get(declaration) ?? new Set<ts.SourceFile>()
          rows.add(source)
          consumers.set(declaration, rows)
        }
        ts.forEachChild(node, index)
      }
      index(source)
    }
  }
  return (source: ts.SourceFile): readonly ts.SourceFile[] => {
    ensureIndex()
    const hit = cache.get(source)
    if (hit) return hit
    const result = new Set<ts.SourceFile>()
    function visit(file: ts.SourceFile) {
      if (result.has(file)) return
      result.add(file)
      for (const consumer of consumers.get(file) ?? []) visit(consumer)
    }
    visit(source)
    const rows = [...result]
    cache.set(source, rows)
    return rows
  }
}
