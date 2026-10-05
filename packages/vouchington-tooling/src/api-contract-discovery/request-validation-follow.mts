import ts from '../contract-schema/typescript-api.mts'
import { findConfig, calleeSymbol } from './request-validation-match.mts'
import type { KeyBindings } from './request-validation-keys.mts'
import type { RootBindings } from './request-validation-origin.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'

type ExportRef = { module: string; exportName: string }

/** Everything needed to resolve keys, origins and followed helpers at one program point. */
export type Scope = {
  checker: ts.TypeChecker
  sourceFiles: ReadonlySet<ts.SourceFile>
  /** Configured validators, factories and callback hosts, whose bodies are never entered. */
  configured: readonly ExportRef[]
  roots: RootBindings
  keys: KeyBindings
}

export type Followable = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression

function constFunction(declaration: ts.VariableDeclaration) {
  const { initializer } = declaration
  return initializer && ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const
    ? unwrapTransparentExpression(initializer)
    : undefined
}

/** Function declarations and const function expressions in `sourceFiles` that a call runs. */
export function followedImplementations(call: ts.CallExpression, scope: Scope): Followable[] {
  if (findConfig(call.expression, scope.configured, scope.checker)) return []
  const declarations = calleeSymbol(call.expression, scope.checker)?.declarations ?? []
  return declarations.flatMap((declaration) => {
    if (!scope.sourceFiles.has(declaration.getSourceFile())) return []
    const implementation = ts.isVariableDeclaration(declaration)
      ? constFunction(declaration)
      : declaration
    return implementation &&
      (ts.isFunctionDeclaration(implementation) ||
        ts.isFunctionExpression(implementation) ||
        ts.isArrowFunction(implementation)) &&
      implementation.body
      ? [implementation]
      : []
  })
}

export const inlineFunction = (node: ts.Node | undefined) => {
  const value = node && ts.isExpression(node) ? unwrapTransparentExpression(node) : node
  return value &&
    (ts.isArrowFunction(value) || ts.isFunctionExpression(value) || ts.isMethodDeclaration(value))
    ? value
    : undefined
}
