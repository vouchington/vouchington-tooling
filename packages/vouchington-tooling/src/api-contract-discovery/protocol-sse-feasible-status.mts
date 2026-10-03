import ts from '../contract-schema/typescript-api.mts'

/** Excludes a sibling branch or a statement that cannot precede this anchor. */
export function statusCanPrecede(setter: ts.Node, anchor: ts.Node): boolean {
  const ancestors = new Set<ts.Node>()
  for (let node: ts.Node | undefined = anchor; node; node = node.parent) ancestors.add(node)
  for (let node: ts.Node = setter; node.parent; node = node.parent) {
    const parent = node.parent
    if (ts.isIfStatement(parent) && parent.elseStatement) {
      const opposite = parent.thenStatement === node ? parent.elseStatement : parent.thenStatement
      if (ancestors.has(opposite)) return false
    }
    if (ts.isBlock(parent) && ancestors.has(parent)) {
      let statement = anchor
      while (statement.parent !== parent) statement = statement.parent
      if (
        parent.statements.indexOf(node as ts.Statement) >
        parent.statements.indexOf(statement as ts.Statement)
      )
        return false
    }
  }
  return true
}
