import ts from '../contract-schema/typescript-api.mts'
import { isCanonicalHttpMethod } from './methods.mts'

export function findBasicAuthExemptPaths(code: string, variableName: string): string[] | null {
  const declaration = findTopLevelConstInitializer(code, variableName)
  if (!declaration) return null
  return stringSetValues(declaration)
}

export function findBasicAuthExemptMethodsByPath(
  code: string,
  variableName: string,
): Map<string, string[]> | null {
  const declaration = findTopLevelConstInitializer(code, variableName)
  if (!declaration || !isNewCollectionExpression(declaration, 'Map')) return null
  const [entriesArg] = declaration.arguments ?? []
  if (!entriesArg || !ts.isArrayLiteralExpression(entriesArg)) return null

  const entries = new Map<string, string[]>()
  for (const entry of entriesArg.elements) {
    if (!ts.isArrayLiteralExpression(entry) || entry.elements.length !== 2) return null
    const path = stringLiteralValue(entry.elements[0])
    const methods = stringSetValues(entry.elements[1])
    if (!path || !methods || methods.length === 0) return null
    if (!methods.every(isCanonicalHttpMethod)) return null
    entries.set(path, methods)
  }

  return entries.size > 0 ? entries : null
}

function findTopLevelConstInitializer(code: string, name: string): ts.Expression | null {
  const source = ts.createSourceFile(
    'basic-auth.mts',
    code,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  )
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue
      return declaration.initializer ?? null
    }
  }
  return null
}

function stringSetValues(expression: ts.Expression | undefined): string[] | null {
  if (!expression || !isNewCollectionExpression(expression, 'Set')) return null
  const [valuesArg] = expression.arguments ?? []
  if (!valuesArg || !ts.isArrayLiteralExpression(valuesArg)) return null
  const values: string[] = []
  for (const element of valuesArg.elements) {
    const value = stringLiteralValue(element)
    if (!value) return null
    values.push(value)
  }
  return values.length > 0 ? values : null
}

function stringLiteralValue(expression: ts.Expression | undefined): string | null {
  if (
    expression &&
    (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
  ) {
    return expression.text
  }
  return null
}

function isNewCollectionExpression(
  expression: ts.Expression,
  collectionName: 'Map' | 'Set',
): expression is ts.NewExpression {
  return (
    ts.isNewExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === collectionName
  )
}
