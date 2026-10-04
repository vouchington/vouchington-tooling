import ts from '@typescript/typescript6'

/** Keep caller-supplied patterns while ignoring matches that begin in inactive source text. */
export function collectActivePatternCaptures(
  content: string,
  pattern: RegExp,
  file: string,
): string[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    content,
  )
  const inactive: { start: number; end: number; literal: boolean }[] = []
  const inactiveKinds = new Set([
    ts.SyntaxKind.SingleLineCommentTrivia,
    ts.SyntaxKind.MultiLineCommentTrivia,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.RegularExpressionLiteral,
  ])
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (inactiveKinds.has(kind))
      inactive.push({
        start: scanner.getTokenPos(),
        end: scanner.getTextPos(),
        literal: kind === ts.SyntaxKind.StringLiteral,
      })
  }
  if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
    const source = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    const visit = (node: ts.Node): void => {
      if (ts.isJsxText(node))
        inactive.push({ start: node.getStart(source), end: node.end, literal: false })
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return [...content.matchAll(pattern)].flatMap((match) => {
    if (
      inactive.some(
        ({ start, end, literal }) =>
          match.index >= start && match.index < end && !(literal && match.index === start),
      )
    )
      return []
    return match[1] === undefined ? [] : [match[1]]
  })
}
