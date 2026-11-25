import {
  markdownLiteralSpans,
  parseMarkdownSections,
  validateMarkdownSections,
  type MarkdownSectionsDocument,
} from '../markdown/index.mts'
import { sanitizedLines } from './sanitized-lines.mts'

export const DEFAULT_REQUIRED_HEADINGS: readonly string[] = ['Summary', 'Impact']
export const DEFAULT_RELATED_ISSUES_HEADING = /^Related\s+issues$/i

export type PrDescriptionContentPolicy = {
  requiredHeadings?: readonly string[]
  relatedIssuesHeading?: RegExp
  missingRelatedIssuesMessage?: string
  diagnosticPrefix?: string
}

function findRelatedIssuesSection(
  document: MarkdownSectionsDocument,
  headingPattern: RegExp,
): { content: string; heading: string; line: number } | undefined {
  return document.sections.find((section) => headingPattern.test(section.heading))
}

/**
 * Extracts the related-issues section with code and raw HTML spans replaced by `\0` (preserving
 * line breaks) so reference parsers ignore syntax inside code blocks, inline code, or HTML.
 */
export function extractRelatedIssuesReferenceText(
  body: string,
  relatedIssuesHeading: RegExp = DEFAULT_RELATED_ISSUES_HEADING,
): string {
  const section =
    findRelatedIssuesSection(parseMarkdownSections(body), relatedIssuesHeading)?.content ?? ''
  const characters = section.split('')
  for (const span of markdownLiteralSpans(section)) {
    const start = span.position.start.offset
    const end = span.position.end.offset
    for (let offset = start; offset < end; offset += 1) {
      if (characters[offset] !== '\n' && characters[offset] !== '\r') characters[offset] = '\0'
    }
  }
  return characters.join('')
}

/** Extracts sanitized lines from the related-issues section (heading line plus body). */
export function extractRelatedIssuesLines(
  body: string,
  relatedIssuesHeading: RegExp = DEFAULT_RELATED_ISSUES_HEADING,
): string[] {
  const section = findRelatedIssuesSection(parseMarkdownSections(body), relatedIssuesHeading)
  if (section === undefined) return []
  const heading = body.split(/\r?\n/)[section.line - 1]!
  return sanitizedLines(`${heading}\n${section.content}`)
}

export function validatePrDescriptionContent(
  body: string,
  policy: PrDescriptionContentPolicy = {},
): {
  errors: string[]
  relatedIssuesSection: string | undefined
} {
  const requiredHeadings = policy.requiredHeadings ?? DEFAULT_REQUIRED_HEADINGS
  const relatedIssuesHeading = policy.relatedIssuesHeading ?? DEFAULT_RELATED_ISSUES_HEADING
  const prefix = policy.diagnosticPrefix ?? 'PR body'
  const document = parseMarkdownSections(body)
  const errors = validateMarkdownSections(document, { requiredHeadings }).map(
    (diagnostic) => `${prefix}: ${diagnostic.message}`,
  )
  const section = findRelatedIssuesSection(document, relatedIssuesHeading)?.content
  if (section === undefined) {
    errors.push(
      policy.missingRelatedIssuesMessage ??
        'PR body must include a "## Related issues" section (e.g. a heading followed by "Closes #123").',
    )
  }
  return { errors, relatedIssuesSection: section }
}
