import {
  formatReferenceKey,
  parseNonClosingRefs,
  type ClosingIssueReference,
  type RunTextCommand,
} from '../gh-cli/index.mts'
import { extractRelatedIssuesReferenceText } from './content-policy.mts'
import {
  formatIssueAuditMarkerHint,
  parseIssueAuditKeepOpenDecisions,
  type IssueAuditKeepOpenDecision,
} from './issue-audit-marker.mts'
import {
  DEFAULT_MILESTONE_COMPLETION_REMAINDER,
  findMilestoneCompletionSiblings,
  type MilestoneGroup,
  type MilestoneSibling,
} from './milestone-query.mts'
import type { ClosingIssueForAudit } from './pr-description-types.mts'

export type MilestoneAuditOptions = {
  remainder?: number
  relatedIssuesHeading?: RegExp
  validClassifications?: ReadonlySet<string>
}

export function groupClosedIssuesByMilestone(
  closingIssues: readonly ClosingIssueForAudit[],
  auditedRepo: string,
): Map<string, MilestoneGroup> {
  const localRepo = auditedRepo.toLowerCase()
  const grouped = new Map<string, MilestoneGroup>()
  for (const { issue, repo } of closingIssues) {
    if (issue.milestone === undefined) continue
    const resolvedRepo = repo ?? localRepo
    const key = `${resolvedRepo} ${issue.milestone}`
    const group = grouped.get(key) ?? {
      milestone: issue.milestone,
      numbers: new Set<number>(),
      repo: resolvedRepo,
    }
    group.numbers.add(issue.number)
    grouped.set(key, group)
  }
  return grouped
}

function formatSiblingKey(sibling: MilestoneSibling, auditedRepo: string): string {
  if (sibling.repo === auditedRepo) return `#${sibling.number}`
  const [owner, repo] = sibling.repo.split('/')
  return formatReferenceKey({ number: sibling.number, owner, repo })
}

function formatKeepOpenKey(decision: IssueAuditKeepOpenDecision): string {
  const [owner, repo] =
    decision.repo !== undefined ? decision.repo.split('/') : [undefined, undefined]
  return formatReferenceKey({ number: decision.number, owner, repo })
}

/**
 * Verifies that every remaining open milestone sibling is dispositioned by a closing reference, a
 * non-closing `Refs`/`Part of` reference in the related-issues section, or an `issue-audit:
 * keep-open` marker. Self-qualified local keys (`owner/repo#N` matching `repo`) normalize to `#N`.
 */
export function validateMilestoneSiblings(
  siblings: readonly MilestoneSibling[],
  body: string,
  closingRefs: readonly ClosingIssueReference[],
  repo: string,
  options: MilestoneAuditOptions = {},
): string[] {
  const remainder = options.remainder ?? DEFAULT_MILESTONE_COMPLETION_REMAINDER
  const auditedRepo = repo.toLowerCase()
  const localPrefix = `${auditedRepo}#`
  const normalizeKey = (key: string): string =>
    key.startsWith(localPrefix) ? `#${key.slice(localPrefix.length)}` : key

  const closedKeys = new Set(closingRefs.map((ref) => normalizeKey(ref.key)))
  const refsKeys = new Set(
    [
      ...parseNonClosingRefs(extractRelatedIssuesReferenceText(body, options.relatedIssuesHeading)),
    ].map(normalizeKey),
  )
  const keptOpenKeys = new Set(
    parseIssueAuditKeepOpenDecisions(body, options.validClassifications).map((decision) =>
      normalizeKey(formatKeepOpenKey(decision)),
    ),
  )

  const errors: string[] = []
  for (const sibling of siblings) {
    const key = formatSiblingKey(sibling, auditedRepo)
    if (closedKeys.has(key) || refsKeys.has(key) || keptOpenKeys.has(key)) continue
    errors.push(
      `${key} ("${sibling.title}") is an open sibling in milestone "${sibling.milestone}", which ` +
        `this PR is completing (≤ ${remainder} issues remain). Add "Closes ` +
        `${key}", "Refs ${key}" with an explanation and issue comment, or ` +
        `${formatIssueAuditMarkerHint(key)} if it should stay open.`,
    )
  }
  return errors
}

export function createMilestoneAuditor(
  runGh: RunTextCommand,
  repo: string,
  options: MilestoneAuditOptions = {},
): (
  body: string,
  closingRefs: ClosingIssueReference[],
  closingIssues: ClosingIssueForAudit[],
) => Promise<string[]> {
  return async (body, closingRefs, closingIssues) => {
    const groups = groupClosedIssuesByMilestone(closingIssues, repo)
    if (groups.size === 0) return []
    const siblings = await findMilestoneCompletionSiblings(runGh, groups, options.remainder)
    if (siblings.length === 0) return []
    return validateMilestoneSiblings(siblings, body, closingRefs, repo, options)
  }
}
