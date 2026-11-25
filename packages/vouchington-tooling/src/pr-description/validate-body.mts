import {
  hasClosingIssueReference,
  validateGitHubBodyLength,
  type GitHubBodyLengthValidation,
} from '../gh-cli/index.mts'
import { validatePrDescriptionContent, type PrDescriptionContentPolicy } from './content-policy.mts'
import { findEscapeCommentClosingKeywordLeaks } from './escape-comment-leaks.mts'
import { extractPartialBatchSourceRef, type PartialBatchTemplate } from './no-source.mts'
import type { ReferencedIssue } from './pr-description-types.mts'

export type PrBodyValidationResult = {
  advisories: string[]
  errors: string[]
  referencedIssues: ReferencedIssue[]
  ok: boolean
}

export type ProvenanceLineRule = {
  label: string
  pattern: RegExp
  message?: string
}

export type NoSourcePolicyRule = {
  matches: (body: string) => boolean
  interactiveOnly?: boolean
  nonInteractiveError?: string
}

export type PrBodyValidationPolicy = PrDescriptionContentPolicy & {
  formatBodyLengthError?: (validation: GitHubBodyLengthValidation) => string
  noSourceRules?: readonly NoSourcePolicyRule[]
  partialBatch?: PartialBatchTemplate
  missingClosingReferenceMessage?: string
  provenanceRules?: readonly ProvenanceLineRule[]
  checkEscapeCommentLeaks?: boolean
}

export type PrBodyValidationOptions = {
  /** Trusted runtime context, never read from the PR body. Omitted context fails closed. */
  automationContext?: boolean
  /** Caller-supplied policy: headings, no-source templates, and provenance rules. */
  policy?: PrBodyValidationPolicy
}

export const DEFAULT_PROVENANCE_RULES: readonly ProvenanceLineRule[] = [
  {
    label: 'Workspace setup:',
    pattern: /^\s*Workspace\s+setup\s*:/im,
    message: 'PR body must include a "Workspace setup:" line.',
  },
  { label: 'Agent:', pattern: /^\s*Agent\s*:\s*\S/im },
  { label: 'Device:', pattern: /^\s*Device\s*:\s*\S/im },
  { label: 'Worktree:', pattern: /^\s*Worktree\s*:\s*\S/im },
]

export function formatGitHubBodyLengthError(validation: GitHubBodyLengthValidation): string {
  const format = (count: number): string => count.toLocaleString('en-US')
  return (
    `GitHub body is ${format(validation.characterCount)} Unicode characters ` +
    `(${format(validation.utf8ByteCount)} UTF-8 bytes); GitHub allows at most ` +
    `${format(validation.maxCharacterCount)} Unicode characters. Save the complete body ` +
    'before editing, preserve required content, and retry only after moving supporting detail ' +
    'to a linked issue or attachment, removing duplicate prose, or compacting only harmless ' +
    'Markdown whitespace; this helper never truncates, normalizes, or compacts content automatically.'
  )
}

function evaluateNoSourceRules(
  body: string,
  policy: PrBodyValidationPolicy,
  interactive: boolean,
  errors: string[],
): boolean {
  let satisfied = false
  for (const rule of policy.noSourceRules ?? []) {
    if (!rule.matches(body)) continue
    if (rule.interactiveOnly === true && !interactive) {
      errors.push(
        rule.nonInteractiveError ??
          'This no-source representation is allowed only in an interactive session.',
      )
      continue
    }
    satisfied = true
  }
  if (
    policy.partialBatch !== undefined &&
    extractPartialBatchSourceRef(body, policy.partialBatch) !== undefined
  ) {
    satisfied = true
  }
  return satisfied
}

export function validatePrBody(
  body: string,
  options: PrBodyValidationOptions = {},
): PrBodyValidationResult {
  const policy = options.policy ?? {}
  const lengthValidation = validateGitHubBodyLength(body)
  if (!lengthValidation.ok) {
    const formatError = policy.formatBodyLengthError ?? formatGitHubBodyLengthError
    return {
      advisories: [],
      errors: [formatError(lengthValidation)],
      ok: false,
      referencedIssues: [],
    }
  }

  const interactive = options.automationContext === false
  const { errors, relatedIssuesSection } = validatePrDescriptionContent(body, policy)
  const noSourceSatisfied = evaluateNoSourceRules(body, policy, interactive, errors)

  if (
    relatedIssuesSection !== undefined &&
    !hasClosingIssueReference(relatedIssuesSection) &&
    !noSourceSatisfied
  ) {
    errors.push(
      policy.missingClosingReferenceMessage ??
        'PR body must include at least one GitHub closing keyword (e.g. "Closes #123") in the "## Related issues" section.',
    )
  }

  for (const rule of policy.provenanceRules ?? DEFAULT_PROVENANCE_RULES) {
    if (!rule.pattern.test(body)) {
      errors.push(rule.message ?? `PR body must include "${rule.label}" line.`)
    }
  }

  if (policy.checkEscapeCommentLeaks !== false) {
    errors.push(...findEscapeCommentClosingKeywordLeaks(body))
  }

  return { advisories: [], errors, ok: errors.length === 0, referencedIssues: [] }
}
