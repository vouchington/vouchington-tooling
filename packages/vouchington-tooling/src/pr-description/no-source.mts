import { formatReferenceKey, type ClosingIssueReference } from '../gh-cli/index.mts'
import { extractRelatedIssuesLines } from './content-policy.mts'
import type { IssueReferenceLookup } from './pr-description-types.mts'
import { sanitizedLines } from './sanitized-lines.mts'

export type NoSourceLinePairTemplate = {
  visibleLine: string
  marker: string
  requiredBodyLines?: ReadonlySet<string>
  /** Patterns that must each match a whole sanitized body line; no `g` or `y` flags. */
  requiredBodyLinePatterns?: readonly RegExp[]
  relatedIssuesHeading?: RegExp
}

export type PartialBatchTemplate = {
  visibleLine: string
  marker: string
  relatedIssuesHeading?: RegExp
}

// Anchors the rendered `- Refs [#N | owner/repo#N] — <reason>` line so prose, inline code, and
// indented or commented copies cannot name the batch's source issue.
const RENDERED_REF_RE = /^- Refs (?:(?<owner>[\w.-]+)\/(?<repo>[\w.-]+))?#(?<number>\d+) — \S.*$/
const RENDERED_ISSUE_RE = /^- (?:Closes|Refs) /

function parseRenderedRefLine(line: string): ClosingIssueReference | undefined {
  const match = RENDERED_REF_RE.exec(line)
  const number = Number(match?.groups?.number)
  if (match === null || !Number.isSafeInteger(number)) return undefined
  const owner = match.groups?.owner?.toLowerCase()
  const repo = match.groups?.repo?.toLowerCase()
  return { key: formatReferenceKey({ number, owner, repo }), number, owner, repo }
}

// Anchoring inside the expression lets the engine backtrack to a whole-line match; checking the
// first `exec` match's length would reject lazy quantifiers and earlier short alternatives.
function wholeLinePattern(pattern: RegExp): RegExp {
  if (pattern.global || pattern.sticky) {
    throw new TypeError(`requiredBodyLinePatterns must not use the g or y flag: ${pattern}`)
  }
  return new RegExp(`^(?:${pattern.source})$`, pattern.flags)
}

function hasRequiredBodyLine(body: string, template: NoSourceLinePairTemplate): boolean {
  const lines = template.requiredBodyLines
  if (lines === undefined && template.requiredBodyLinePatterns === undefined) return true
  const patterns = (template.requiredBodyLinePatterns ?? []).map(wholeLinePattern)
  return sanitizedLines(body).some(
    (line) => lines?.has(line) === true || patterns.some((pattern) => pattern.test(line)),
  )
}

/**
 * Matches a caller-supplied exact `[visibleLine, marker]` pair inside the sanitized related-issues
 * section, optionally requiring at least one sanitized body line that is in `requiredBodyLines` or
 * wholly matches one of `requiredBodyLinePatterns`.
 */
export function hasRelatedIssuesNoSourcePair(
  body: string,
  template: NoSourceLinePairTemplate,
): boolean {
  const relatedIssuesLines = extractRelatedIssuesLines(body, template.relatedIssuesHeading)
  const hasPair = relatedIssuesLines.some(
    (line, index) =>
      line === template.visibleLine && relatedIssuesLines[index + 1] === template.marker,
  )
  return hasPair && hasRequiredBodyLine(body, template)
}

/**
 * Extracts the source issue of a partial batch: the related-issues section must hold exactly one
 * rendered issue line, a `- Refs ...` entry immediately above the caller's `[visibleLine, marker]`
 * declaration pair.
 */
export function extractPartialBatchSourceRef(
  body: string,
  template: PartialBatchTemplate,
): ClosingIssueReference | undefined {
  const lines = extractRelatedIssuesLines(body, template.relatedIssuesHeading).filter(
    (line) => line.trim() !== '',
  )
  const indexes = lines.flatMap((line, index) =>
    line === template.visibleLine && lines[index + 1] === template.marker ? [index] : [],
  )
  if (indexes.length !== 1 || lines.filter((line) => RENDERED_ISSUE_RE.test(line)).length !== 1) {
    return undefined
  }
  return parseRenderedRefLine(lines[indexes[0]! - 1]!)
}

export function validatePartialBatchSourceRef(
  ref: ClosingIssueReference | undefined,
  lookup: IssueReferenceLookup | undefined,
  allowClosed = false,
): string[] {
  if (ref === undefined || lookup === undefined) return []
  const context = 'A partial batch requires an existing open source issue.'
  if (!lookup.ok) return [`${ref.key} could not be resolved: ${lookup.error}. ${context}`]
  if (lookup.issue.isPullRequest) return [`${ref.key} is a pull request, not an issue. ${context}`]
  if (!allowClosed && lookup.issue.state.toLowerCase() !== 'open') {
    return [`${ref.key} is ${lookup.issue.state.toUpperCase()}. ${context}`]
  }
  return []
}
