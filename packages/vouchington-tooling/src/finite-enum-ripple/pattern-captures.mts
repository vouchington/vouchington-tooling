import ts from '@typescript/typescript6'

/** Keep caller-supplied patterns while ignoring matches that begin in inactive source text. */
export function collectActivePatternCaptures(
  content: string,
  pattern: RegExp,
  file: string,
): string[] {
  const astInactive: { start: number; end: number }[] = []
  const astLiterals: { start: number; end: number }[] = []
  const commentRanges = new Map<string, { start: number; end: number }>()
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
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      astLiterals.push({ start: node.getStart(source), end: node.end })
    else if (
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    )
      astInactive.push({ start: node.getStart(source), end: node.end })
    for (const range of [
      ...(ts.getLeadingCommentRanges(content, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(content, node.end) ?? []),
    ])
      commentRanges.set(`${range.pos}:${range.end}`, { start: range.pos, end: range.end })
    ts.forEachChild(node, collectAstInactive)
  }
  collectAstInactive(source)
  const inactive = [
    ...[...commentRanges.values()]
      .filter(({ start, end }) => !astInactive.some((span) => start < span.end && end > span.start))
      .map(({ start, end }) => ({ start, end, literal: false })),
    ...astInactive.map(({ start, end }) => ({ start, end, literal: false })),
    ...astLiterals.map(({ start, end }) => ({ start, end, literal: true })),
  ]
  const flags = pattern.global ? pattern.flags : `${pattern.flags}g`
  const globalPattern = new RegExp(pattern.source, flags)
  return [...content.matchAll(globalPattern)].flatMap((match) => {
    if (
      inactive.some(
        ({ start, end, literal }) =>
          match.index >= start &&
          match.index < end &&
          !(literal && match.index === start) &&
          !(
            literal &&
            match.index === start + 1 &&
            content[match.index] === '/' &&
            match.index + match[0].length === end - 1
          ),
      )
    )
      return []
    return match[1] === undefined ? [] : [match[1]]
  })
}
