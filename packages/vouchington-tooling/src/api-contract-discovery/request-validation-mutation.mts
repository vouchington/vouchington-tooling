import ts from '../contract-schema/typescript-api.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'
import { resolveSymbol } from './response-contract-symbols.mts'

const MUTATORS = new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf'])
const UPDATES = new Set([ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken])

type Writes = Map<ts.Symbol, number[]>

/**
 * Property-write start positions per symbol, per function (or source file). Symbols belong to one
 * checker, so the memo is keyed by checker and never leaks between programs.
 */
const writesByChecker = new WeakMap<ts.TypeChecker, WeakMap<ts.Node, Writes>>()

const isMember = (
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression =>
  ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)

/** The identifier an `a.b[c]` chain starts from, through parentheses, `!` and `as`. */
function rootIdentifier(target: ts.Expression): ts.Identifier | undefined {
  let current = unwrapTransparentExpression(target)
  while (isMember(current)) current = unwrapTransparentExpression(current.expression)
  return ts.isIdentifier(current) ? current : undefined
}

/** The object a node writes a property of: `o.p = v`, `delete o.p`, `o.p++`, `Object.assign(o)`. */
function mutatedObject(node: ts.Node): ts.Identifier | undefined {
  let target: ts.Expression | undefined
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  )
    target = node.left
  else if (ts.isDeleteExpression(node)) target = node.expression
  else if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    UPDATES.has(node.operator)
  )
    target = node.operand
  if (target) return isMember(target) ? rootIdentifier(target) : undefined
  const callee = ts.isCallExpression(node) ? node.expression : undefined
  const mutates =
    callee &&
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'Object' &&
    MUTATORS.has(callee.name.text)
  const [first] = mutates ? (node as ts.CallExpression).arguments : []
  return first ? rootIdentifier(first) : undefined
}

function propertyWrites(scope: ts.Node, checker: ts.TypeChecker) {
  const scopes = writesByChecker.get(checker) ?? new WeakMap<ts.Node, Writes>()
  writesByChecker.set(checker, scopes)
  const cached = scopes.get(scope)
  if (cached) return cached
  const found: Writes = new Map()
  const scan = (node: ts.Node): void => {
    if (node !== scope && ts.isFunctionLike(node)) return
    const object = mutatedObject(node)
    const symbol = object && checker.getSymbolAtLocation(object)
    if (symbol) found.set(symbol, [...(found.get(symbol) ?? []), node.getStart()])
    ts.forEachChild(node, scan)
  }
  scan(scope)
  scopes.set(scope, found)
  return found
}

function ownerOf(node: ts.Node): ts.Node {
  let current = node.parent
  while (current && !ts.isFunctionLike(current)) current = current.parent
  return current ?? node.getSourceFile()
}

/**
 * True when a property of the const object an identifier names may have been written before the
 * use: in the use's own function, or anywhere in the declaring function or module when that
 * differs. `const` fixes the binding, not the object, so a written object is not its initializer.
 */
export function hasPropertyWriteBefore(
  identifier: ts.Identifier,
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
) {
  const resolved = resolveSymbol(symbol, checker)
  const useScope = ownerOf(identifier)
  const declaration = resolved.declarations!.find(ts.isVariableDeclaration)!
  return [...new Set([useScope, ownerOf(declaration)])].some((scope) =>
    [symbol, resolved].some((candidate) =>
      propertyWrites(scope, checker)
        .get(candidate)
        ?.some((start) => scope !== useScope || start < identifier.getStart()),
    ),
  )
}
