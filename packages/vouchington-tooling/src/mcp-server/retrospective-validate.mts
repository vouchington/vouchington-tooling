import { validateAssessments } from './retrospective-validate-assessments.mts'
import { validateCiFailures } from './retrospective-validate-ci.mts'

const REQUIRED_LINES = [
  '## Verifiable Facts',
  '=== Retrospective Facts ===',
  '## Transcript Facts',
  '=== Transcript Facts ===',
]
const INCOMPLETE = /^Status: (?:unavailable|not assessed|partial)/

/** Lines that say a source was not fully assessed, each with the section it sits in. */
function incompleteSources(lines: string[]): string[] {
  let section = 'the front of the document'
  const found: string[] = []
  for (const line of lines) {
    if (line.startsWith('## ') || line.startsWith('=== ')) section = `"${line}"`
    else if (INCOMPLETE.test(line)) found.push(`${JSON.stringify(line)} in ${section}`)
  }
  return found
}

/**
 * Checks a hand-written retrospective against the section grammar `composeRetrospective` writes
 * and returns one actionable message per problem (empty when the document conforms). Front
 * matter is checked separately by `parseRetrospectiveFrontMatter`.
 */
export function validateRetrospectiveMarkdown(
  markdown: string,
  feedbackCoverageStatus: string,
): string[] {
  const lines = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  const errors = REQUIRED_LINES.filter((line) => !lines.includes(line)).map(
    (line) => `missing the required line "${line}"`,
  )
  errors.push(...validateCiFailures(lines), ...validateAssessments(lines))
  const incomplete = incompleteSources(lines)
  if (feedbackCoverageStatus === 'complete' && incomplete.length)
    errors.push(
      `feedbackCoverage "complete" contradicts unassessed sources (${incomplete.join('; ')}); assess them, or save with a feedbackCoverage status other than "complete"`,
    )
  return errors
}
