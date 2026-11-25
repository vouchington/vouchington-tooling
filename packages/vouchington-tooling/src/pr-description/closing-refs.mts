import { formatReferenceKey, type ClosingIssueReference } from '../gh-cli/index.mts'
import { hasUncheckedMarkdownTask } from '../markdown/index.mts'
import type { IssueReferenceLookup, ReferencedIssue } from './pr-description-types.mts'

export type IssueReferenceValidationResult = {
  errors: string[]
  issues: ReferencedIssue[]
}

type GitHubIssueApiResponse = {
  body?: string | null
  html_url?: string
  milestone?: { title?: string } | null
  number?: number
  pull_request?: unknown
  state?: string
  title?: string
}

export const ESCAPE_COMMENT_RE =
  /<!--\s*related-issues-validation:\s*allow\s+(?<ref>(?:[\w.-]+\/[\w.-]+)?#\d+)\s+because\s+(?<reason>.*?)-->/gis

function normalizeEscapeReference(ref: string): string {
  const match = /^(?:(?<owner>[\w.-]+)\/(?<repo>[\w.-]+))?#(?<number>\d+)$/.exec(ref.trim())!
  return formatReferenceKey({
    number: Number(match.groups!.number),
    owner: match.groups!.owner?.toLowerCase(),
    repo: match.groups!.repo?.toLowerCase(),
  })
}

function hasIssueReferenceEscape(body: string, ref: ClosingIssueReference): boolean {
  for (const match of body.matchAll(ESCAPE_COMMENT_RE)) {
    const escapedRef = normalizeEscapeReference(match.groups!.ref!)
    const reason = match.groups!.reason!.trim()
    if (escapedRef === ref.key && reason.length > 0) return true
  }
  return false
}

function pushUnlessEscaped(
  errors: string[],
  body: string,
  ref: ClosingIssueReference,
  message: string,
): void {
  if (hasIssueReferenceEscape(body, ref)) return
  errors.push(
    `${message} Add "<!-- related-issues-validation: allow ${ref.key} because <reason> -->" only for an intentional exception.`,
  )
}

export function validateResolvedIssueReferences(
  body: string,
  refs: readonly ClosingIssueReference[],
  lookups: ReadonlyMap<string, IssueReferenceLookup>,
  allowedClosedReferences: ReadonlySet<string> = new Set(),
  requireClosedReferences = false,
): IssueReferenceValidationResult {
  const errors: string[] = []
  const issues: ReferencedIssue[] = []

  for (const ref of refs) {
    const lookup = lookups.get(ref.key)
    if (lookup?.ok === true) {
      const issue = lookup.issue
      const { body: issueBody, isPullRequest, state, title } = issue
      issues.push(issue)
      if (isPullRequest) {
        pushUnlessEscaped(
          errors,
          body,
          ref,
          `${ref.key} resolves to a pull request, not an issue (${title}).`,
        )
      } else if (state.toLowerCase() === 'open' && requireClosedReferences) {
        pushUnlessEscaped(errors, body, ref, `${ref.key} remains OPEN after merge: ${title}.`)
      } else if (state.toLowerCase() !== 'open' && !allowedClosedReferences.has(ref.key)) {
        pushUnlessEscaped(errors, body, ref, `${ref.key} is ${state.toUpperCase()}: ${title}.`)
      }
      if (hasUncheckedMarkdownTask(issueBody)) {
        pushUnlessEscaped(
          errors,
          body,
          ref,
          `${ref.key} contains at least one unchecked task: ${title}.`,
        )
      }
      continue
    }

    pushUnlessEscaped(
      errors,
      body,
      ref,
      `${ref.key} could not be resolved as an open GitHub issue${
        lookup?.ok === false ? `: ${lookup.error}` : '.'
      }`,
    )
  }

  return { errors, issues }
}

export function parseGitHubIssueApiResponse(json: string): ReferencedIssue {
  const parsed = JSON.parse(json) as GitHubIssueApiResponse
  const { html_url, number, state, title } = parsed
  if (
    typeof html_url !== 'string' ||
    typeof number !== 'number' ||
    typeof state !== 'string' ||
    typeof title !== 'string'
  ) {
    const missingFields = [
      typeof html_url !== 'string' && 'html_url',
      typeof number !== 'number' && 'number',
      typeof state !== 'string' && 'state',
      typeof title !== 'string' && 'title',
    ].filter((field): field is string => field !== false)
    throw new Error(`GitHub issue response missing required fields: ${missingFields.join(', ')}`)
  }

  return {
    body: typeof parsed.body === 'string' ? parsed.body : '',
    isPullRequest: parsed.pull_request !== undefined,
    milestone: typeof parsed.milestone?.title === 'string' ? parsed.milestone.title : undefined,
    number,
    state,
    title,
    url: html_url,
  }
}
