import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import {
  globalTarget,
  literalStrings,
  mutatorKind,
  sourceKeys,
} from './protocol-platform-mutation-targets.mts'

const platformNames = ['setTimeout', 'setInterval', 'Promise']

/** Records global timer and Promise writes, including calls to standard property mutators. */
export function writtenPlatformSymbols(
  files: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  libraries?: ReadonlySet<ts.SourceFile>,
): Set<ts.Symbol> {
  const written = new Set<ts.Symbol>()
  function mark(target: ts.Expression, keys: readonly string[] | undefined) {
    const root = globalTarget(target, checker)
    if (!root) return
    const members = keys
      ? keys.map((key) => checker.getPropertyOfType(checker.getTypeAtLocation(root), key))
      : platformNames.map((name) =>
          checker.getPropertyOfType(checker.getTypeAtLocation(root), name),
        )
    for (const member of members)
      if (member && platformNames.includes(member.name)) written.add(member)
  }
  function target(node: ts.Node) {
    if (ts.isElementAccessExpression(node)) {
      const keys = literalStrings(node.argumentExpression, checker)
      mark(node.expression, keys)
      return
    }
    if (ts.isPropertyAccessExpression(node)) {
      const symbol = checker.getSymbolAtLocation(node.name)
      if (globalTarget(node.expression, checker) && symbol && platformNames.includes(symbol.name))
        written.add(symbol)
      return
    }
    const symbol = checker.getSymbolAtLocation(node)
    if (symbol && platformNames.includes(symbol.name)) written.add(symbol)
    if (
      ts.isObjectLiteralExpression(node) ||
      ts.isArrayLiteralExpression(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isSpreadAssignment(node) ||
      ts.isSpreadElement(node)
    )
      ts.forEachChild(node, target)
  }
  function visit(node: ts.Node) {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      target(node.left)
    if (ts.isDeleteExpression(node)) target(node.expression)
    if (ts.isCallExpression(node)) {
      const kind = mutatorKind(node, checker, libraries)
      if (kind && node.arguments[0] && ts.isSpreadElement(node.arguments[0]))
        for (const file of files)
          for (const binding of checker.getSymbolsInScope(
            file,
            ts.SymbolFlags.Value | ts.SymbolFlags.Alias,
          )) {
            const symbol =
              binding.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(binding) : binding
            if (platformNames.includes(symbol.name)) written.add(symbol)
          }
      if (kind === 'defineProperty' || kind === 'set') {
        const receiver = node.arguments[0]
        if (receiver && !ts.isSpreadElement(receiver))
          mark(
            receiver,
            literalStrings(
              node.arguments[1] && !ts.isSpreadElement(node.arguments[1])
                ? node.arguments[1]
                : undefined,
              checker,
            ),
          )
      } else if (kind === 'assign') {
        const receiver = node.arguments[0]
        if (receiver && !ts.isSpreadElement(receiver) && globalTarget(receiver, checker)) {
          for (const source of node.arguments.slice(1)) {
            if (ts.isSpreadElement(source)) {
              const values = unwrapExpression(source.expression)
              if (ts.isArrayLiteralExpression(values)) {
                for (const value of values.elements)
                  if (ts.isSpreadElement(value)) mark(receiver, undefined)
                  else mark(receiver, sourceKeys(value, checker))
              } else mark(receiver, undefined)
            } else mark(receiver, sourceKeys(source, checker))
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  for (const file of files) if (!file.isDeclarationFile) visit(file)
  return written
}
