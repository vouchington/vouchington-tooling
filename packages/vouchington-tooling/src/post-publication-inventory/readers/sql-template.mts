import ts from '../../contract-schema/typescript-api.mts'

export interface ReaderSqlTemplateOptions {
  readonly templateTag: string
  readonly appendMethod: string
  readonly executorImports: ReadonlyMap<string, ReadonlySet<string>>
  readonly placeholderPrefix: string
}

export function simpleName(node: ts.Node): string | undefined {
  node = unparenthesized(node)
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined
}

export function unparenthesized(node: ts.Node): ts.Node {
  while (ts.isParenthesizedExpression(node)) node = node.expression
  return node
}

export function staticSqlTemplateText(
  node: ts.Node | undefined,
  options: ReaderSqlTemplateOptions,
): string | undefined {
  if (!node) return undefined
  node = unparenthesized(node)
  if (ts.isTaggedTemplateExpression(node)) {
    if (simpleName(node.tag) !== options.templateTag) return undefined
    node = node.template
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.rawText ?? node.text
  if (!ts.isTemplateExpression(node)) return undefined
  return [
    node.head.rawText ?? node.head.text,
    ...node.templateSpans.map(
      (span, index) =>
        `${options.placeholderPrefix}${index + 1}${span.literal.rawText ?? span.literal.text}`,
    ),
  ].join('')
}

export function walk(root: ts.Node, visit: (node: ts.Node) => void): void {
  visit(root)
  // Retain the existing analyzer's alternate-before-consequent branch order.
  // Concatenated fragment order is observable even though this is not execution analysis.
  if (ts.isIfStatement(root)) {
    if (root.elseStatement) walk(root.elseStatement, visit)
    walk(root.thenStatement, visit)
    walk(root.expression, visit)
    return
  }
  if (ts.isConditionalExpression(root)) {
    walk(root.whenFalse, visit)
    walk(root.whenTrue, visit)
    walk(root.condition, visit)
    return
  }
  if (ts.isCallExpression(root)) {
    for (const argument of root.arguments) walk(argument, visit)
    walk(root.expression, visit)
    for (const typeArgument of root.typeArguments ?? []) walk(typeArgument, visit)
    return
  }
  if (ts.isFunctionDeclaration(root) || ts.isFunctionExpression(root) || ts.isArrowFunction(root)) {
    if (root.body) walk(root.body, visit)
    for (const parameter of root.parameters) walk(parameter, visit)
    return
  }
  if (ts.isForStatement(root)) {
    walk(root.statement, visit)
    for (const header of [root.initializer, root.condition, root.incrementor]) {
      if (header) walk(header, visit)
    }
    return
  }
  if (ts.isWhileStatement(root) || ts.isForInStatement(root) || ts.isForOfStatement(root)) {
    walk(root.statement, visit)
    if (ts.isForInStatement(root) || ts.isForOfStatement(root)) walk(root.initializer, visit)
    walk(root.expression, visit)
    return
  }
  if (ts.isTryStatement(root)) {
    walk(root.tryBlock, visit)
    if (root.finallyBlock) walk(root.finallyBlock, visit)
    if (root.catchClause) walk(root.catchClause, visit)
    return
  }
  if (ts.isSwitchStatement(root)) {
    walk(root.caseBlock, visit)
    walk(root.expression, visit)
    return
  }
  if (ts.isCaseClause(root)) {
    for (const statement of root.statements) walk(statement, visit)
    walk(root.expression, visit)
    return
  }
  ts.forEachChild(root, (node) => walk(node, visit))
}
