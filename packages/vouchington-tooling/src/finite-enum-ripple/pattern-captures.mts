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
  const astInactive: { start: number; end: number }[] = []
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const collectAstInactive = (node: ts.Node): void => {
    if (ts.isJsxText(node) || ts.isRegularExpressionLiteral(node))
      astInactive.push({ start: node.getStart(source), end: node.end })
    ts.forEachChild(node, collectAstInactive)
  }
  collectAstInactive(source)
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
  const templateBraceDepth: number[] = []
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.TemplateHead) templateBraceDepth.push(0)
    else if (kind === ts.SyntaxKind.OpenBraceToken && templateBraceDepth.length) {
      templateBraceDepth[templateBraceDepth.length - 1]!++
    } else if (kind === ts.SyntaxKind.CloseBraceToken && templateBraceDepth.length) {
      const depth = templateBraceDepth.length - 1
      if (templateBraceDepth[depth] === 0) {
        kind = scanner.reScanTemplateToken(false)
        if (kind === ts.SyntaxKind.TemplateTail) templateBraceDepth.pop()
      } else templateBraceDepth[depth]!--
    }
    if (
      inactiveKinds.has(kind) &&
      !astInactive.some(
        ({ start, end }) => scanner.getTokenPos() < end && scanner.getTextPos() > start,
      )
    )
      inactive.push({
        start: scanner.getTokenPos(),
        end: scanner.getTextPos(),
        literal:
          kind === ts.SyntaxKind.StringLiteral ||
          kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral,
      })
  }
  inactive.push(...astInactive.map(({ start, end }) => ({ start, end, literal: false })))
  const globalPattern = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`)
  return [...content.matchAll(globalPattern)].flatMap((match) => {
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
