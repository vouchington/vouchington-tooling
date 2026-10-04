import ts from '@typescript/typescript6'

/** Keep caller-supplied patterns while ignoring matches that begin in inactive source text. */
export function collectActivePatternCaptures(content: string, pattern: RegExp): string[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    content,
  )
  const inactive: { start: number; end: number }[] = []
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
      inactive.push({ start: scanner.getTokenPos(), end: scanner.getTextPos() })
  }
  return [...content.matchAll(pattern)].flatMap((match) => {
    if (inactive.some(({ start, end }) => match.index >= start && match.index < end)) return []
    return match[1] ? [match[1]] : []
  })
}
