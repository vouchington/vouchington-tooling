/**
 * `<!-- issue-audit: keep-open [owner/repo]#N because <classification>: <reason> -->` — records
 * that an audited issue deliberately stays open. Shared by supersession auditing (same-repo hits)
 * and milestone-completion auditing (local or foreign siblings).
 */

export type AuditClassification =
  | 'evidence-gated'
  | 'live-credential-required'
  | 'locally-actionable'
  | 'unrelated'

export type IssueAuditKeepOpenDecision = {
  classification: string
  number: number
  reason: string
  repo: string | undefined
}

export const DEFAULT_AUDIT_CLASSIFICATIONS: ReadonlySet<AuditClassification> = new Set([
  'evidence-gated',
  'live-credential-required',
  'locally-actionable',
  'unrelated',
])

// `reason` omits surrounding `\s*` so an unterminated marker cannot backtrack catastrophically;
// `parseIssueAuditKeepOpenDecisions` trims the captured reason directly.
const ISSUE_AUDIT_KEEP_OPEN_RE =
  /<!--\s*issue-audit:\s*keep-open\s+(?:(?<ownerRepo>[\w.-]+\/[\w.-]+))?#(?<number>\d+)\s+because\s+(?<classification>[\w-]+):(?<reason>.*?)-->/gis

export function isValidAuditClassification(
  value: string,
  validClassifications: ReadonlySet<string> = DEFAULT_AUDIT_CLASSIFICATIONS,
): boolean {
  return validClassifications.has(value)
}

/**
 * Parses every well-formed `issue-audit: keep-open` marker in a PR body. Markers with an
 * unrecognized classification or an empty reason are skipped so callers report them as
 * undispositioned.
 */
export function parseIssueAuditKeepOpenDecisions(
  body: string,
  validClassifications: ReadonlySet<string> = DEFAULT_AUDIT_CLASSIFICATIONS,
): IssueAuditKeepOpenDecision[] {
  const decisions: IssueAuditKeepOpenDecision[] = []

  for (const match of body.matchAll(ISSUE_AUDIT_KEEP_OPEN_RE)) {
    const number = Number(match.groups?.number)
    const classification = match.groups?.classification
    const reason = match.groups?.reason?.trim()
    const repo = match.groups?.ownerRepo?.toLowerCase()
    if (!Number.isSafeInteger(number)) continue
    if (
      classification === undefined ||
      !isValidAuditClassification(classification, validClassifications)
    ) {
      continue
    }
    if (reason === undefined || reason.length === 0) continue
    decisions.push({ classification, number, reason, repo })
  }

  return decisions
}

/** `key` is a pre-formatted reference (`#N` or `owner/repo#N`). */
export function formatIssueAuditMarkerHint(key: string): string {
  return `<!-- issue-audit: keep-open ${key} because <classification>: <reason> -->`
}
