import ts from '../contract-schema/typescript-api.mts'

import { parseMarkdownTables } from '../markdown/index.mts'

const HTTP_METHOD_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Z]+$/
const METHODS_CELL_RE = /^`[^`]+`(?:\s*,\s*`[^`]+`)*$/

export type ExemptRoute = {
  methods: string[]
  path: string
}

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

function codeText(cell: string): string | null {
  const match = /^`([^`]+)`$/.exec(cell)
  return match?.[1] ?? null
}

function isCanonicalHttpMethod(method: string): boolean {
  return method === method.toUpperCase() && HTTP_METHOD_TOKEN_RE.test(method)
}

function methodTexts(cell: string): string[] | null {
  if (!METHODS_CELL_RE.test(cell)) return null
  const methods = Array.from(cell.matchAll(/`([^`]+)`/g), (match) => match[1]).filter(
    (value): value is string => value !== undefined,
  )
  return methods.every(isCanonicalHttpMethod) ? methods : null
}

function tableHeaderColumns(cells: string[]): Map<string, number> {
  return new Map(cells.map((cell, index) => [cell.toLowerCase(), index]))
}

export function findRunbookExemptRoutes(markdown: string, heading: string): ExemptRoute[] | null {
  const lines = markdown.split(/\r?\n/)
  const headingIndex = lines.findIndex(
    (line) => /^###\s+(.+?)\s*$/.exec(line.trim())?.[1]?.toLowerCase() === heading.toLowerCase(),
  )
  if (headingIndex === -1) return null
  const lineOffset = headingIndex + 1
  const table = parseMarkdownTables(lines.slice(lineOffset).join('\n'), {
    preserveInlineCodeMarkers: true,
  })[0]
  if (!table || table.length < 2) return null

  const routes: ExemptRoute[] = []
  const header = table[0]
  const columns = tableHeaderColumns(header?.cells ?? [])
  const pathColumn = columns.get('path') ?? -1
  const methodsColumn = columns.get('methods') ?? -1
  if (pathColumn === -1 || methodsColumn === -1) return null

  for (const row of table.slice(1)) {
    const path = codeText(row.cells[pathColumn] ?? '')
    const methods = methodTexts(row.cells[methodsColumn] ?? '')
    if (!path) return null
    if (!methods || methods.length === 0) return null
    routes.push({ methods, path })
  }

  return routes.length > 0 ? routes : null
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
