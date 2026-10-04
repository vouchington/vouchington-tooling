import ts from '../../contract-schema/typescript-api.mts'
import type { PostPublicationWriterSourceOptions } from './types.mts'
const DML = /\b(?:INSERT\s+INTO|UPDATE(?:\s+ONLY)?|DELETE\s+FROM)\b/i
const DML_PREFIX = /\b(?:INSERT\s+INTO|UPDATE(?:\s+ONLY)?|DELETE\s+FROM)\s*$/i

export type PostPublicationWriterSourceAnalysis = {
  readonly callsApprovedCaptureHelper: boolean
  readonly optsOutOfPublicationCapture: boolean
  readonly writesConfigEntityTable: boolean
  readonly writesGeneratedRelationTable: boolean
  readonly writesEligibilityTable: boolean
}

export function analyzePostPublicationWriterSource(
  source: string,
  path: string,
  options: PostPublicationWriterSourceOptions,
): PostPublicationWriterSourceAnalysis {
  const captureBindings = new Set<string>()
  const invokedIdentifiers = new Set<string>()
  const relationTableBindings = new Set<string>()
  let optsOutOfPublicationCapture = false
  let hasConfigEntityTable = false
  let hasDmlPrefix = false
  let buildsRelationInsert = false
  let appendsRelationTable = false
  let writesEligibilityTable = false
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) collectCaptureBindings(node, captureBindings, options)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      invokedIdentifiers.add(node.expression.text)
      buildsRelationInsert ||= node.expression.text === options.insertBuilder
      hasConfigEntityTable ||= isConfigEntityTableAssertion(node, options)
    }
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === options.captureOption &&
      node.initializer.kind === ts.SyntaxKind.FalseKeyword
    )
      optsOutOfPublicationCapture = true
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isEntityRelationElectionTableIdentifier(node.initializer, options)
    )
      relationTableBindings.add(node.name.text)
    if (ts.isCallExpression(node) && isRelationTableAppend(node, relationTableBindings, options))
      appendsRelationTable = true
    if (isSqlTextNode(node)) {
      const text = sqlText(node)
      if (!ts.isStringLiteral(node)) hasDmlPrefix ||= DML_PREFIX.test(text)
      if (DML.test(text)) {
        const table = writtenTableName(text)
        writesEligibilityTable ||=
          options.eligibilityTables.has(table ?? '') ||
          (ts.isTemplateExpression(node) && dynamicEligibilityTable(node, options))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return {
    callsApprovedCaptureHelper: [...captureBindings].some((binding) =>
      invokedIdentifiers.has(binding),
    ),
    optsOutOfPublicationCapture,
    writesConfigEntityTable: hasConfigEntityTable && hasDmlPrefix,
    writesGeneratedRelationTable: buildsRelationInsert || (appendsRelationTable && hasDmlPrefix),
    writesEligibilityTable,
  }
}

function collectCaptureBindings(
  node: ts.ImportDeclaration,
  bindings: Set<string>,
  options: PostPublicationWriterSourceOptions,
): void {
  if (
    !ts.isStringLiteral(node.moduleSpecifier) ||
    !options.captureModules.has(node.moduleSpecifier.text)
  )
    return
  const namedBindings = node.importClause?.namedBindings
  if (!namedBindings || !ts.isNamedImports(namedBindings)) return
  for (const binding of namedBindings.elements) {
    const importedName = binding.propertyName?.text ?? binding.name.text
    if (options.captureSymbols.has(importedName)) bindings.add(binding.name.text)
  }
}
function isConfigEntityTableAssertion(
  node: ts.CallExpression,
  options: PostPublicationWriterSourceOptions,
): boolean {
  return (
    ts.isIdentifier(node.expression) &&
    node.expression.text === options.identifierAssertion &&
    isConfigEntityTable(node.arguments[0], options)
  )
}
function isRelationTableAppend(
  node: ts.CallExpression,
  bindings: Set<string>,
  options: PostPublicationWriterSourceOptions,
): boolean {
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== options.appendMethod
  )
    return false
  const argument = node.arguments[0]
  return (
    !!argument &&
    (isRelationTableName(argument, options) ||
      (ts.isIdentifier(argument) && bindings.has(argument.text)))
  )
}
function isEntityRelationElectionTableIdentifier(
  initializer: ts.Expression | undefined,
  options: PostPublicationWriterSourceOptions,
): boolean {
  return Boolean(
    initializer &&
    ts.isCallExpression(initializer) &&
    ts.isIdentifier(initializer.expression) &&
    initializer.expression.text === options.identifierAssertion &&
    initializer.arguments.some(
      (argument) =>
        ts.isIdentifier(argument) && argument.text === options.relationElectionAllowlist,
    ),
  )
}
function isConfigEntityTable(
  node: ts.Expression | undefined,
  options: PostPublicationWriterSourceOptions,
): boolean {
  return Boolean(
    node &&
    ts.isPropertyAccessExpression(node) &&
    node.name.text === options.entityTable.property &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === options.entityTable.receiver,
  )
}
function isRelationTableName(
  node: ts.Expression | undefined,
  options: PostPublicationWriterSourceOptions,
): boolean {
  return Boolean(
    node &&
    ts.isPropertyAccessExpression(node) &&
    node.name.text === options.relationTable.property &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === options.relationTable.receiver,
  )
}
function isSqlTextNode(
  node: ts.Node,
): node is ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression | ts.StringLiteral {
  return (
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node) ||
    ts.isStringLiteral(node)
  )
}
function sqlText(
  node: ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression | ts.StringLiteral,
): string {
  if (ts.isStringLiteral(node)) return node.text
  return ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('')
}
function writtenTableName(text: string): string | undefined {
  return /\b(?:INSERT\s+INTO|UPDATE(?:\s+ONLY)?|DELETE\s+FROM)\s+(?:(?:"?[\w$]+"?\.)?"?)([\w$]+)"?/i
    .exec(text)?.[1]
    ?.toLowerCase()
}
function dynamicEligibilityTable(
  node: ts.TemplateExpression,
  options: PostPublicationWriterSourceOptions,
): boolean {
  if (
    !/\b(?:INSERT\s+INTO|UPDATE(?:\s+ONLY)?|DELETE\s+FROM)\s+(?:(?:"?[\w$]+"?\.)?)$/i.test(
      node.head.text,
    )
  )
    return false
  const expression = node.templateSpans[0]?.expression
  return (
    expression !== undefined &&
    ts.isStringLiteral(expression) &&
    options.eligibilityTables.has(expression.text)
  )
}
