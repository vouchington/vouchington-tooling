import {
  parseClosingIssueReferences,
  type ClosingIssueReference,
  type RunTextCommand,
} from '../gh-cli/index.mts'
import {
  formatIssueAuditMarkerHint,
  parseIssueAuditKeepOpenDecisions,
  type IssueAuditKeepOpenDecision,
} from './issue-audit-marker.mts'
import type { DiffSummary, PackageJsonReader } from './pr-description-types.mts'
import { formatRelatedIssueHints } from './related-issues.mts'
import { findRemovedScripts } from './removed-scripts.mts'
import { buildRemovalVocabulary } from './removed-surfaces.mts'

export type SupersessionVocabularyOptions = {
  limit?: number
  stoplist?: ReadonlySet<string>
}

export type SupersessionAuditOptions = SupersessionVocabularyOptions & {
  validClassifications?: ReadonlySet<string>
}

async function buildRemovalTerms(
  summary: DiffSummary,
  readPackageJson: PackageJsonReader,
  options: SupersessionVocabularyOptions = {},
): Promise<string[]> {
  const surfaces = [...summary.removedSurfaces]
  surfaces.push(...(await findRemovedScripts(summary.changedPackageJsonPaths, readPackageJson)))
  return buildRemovalVocabulary(surfaces, options.limit, options.stoplist).terms
}

export type SupersessionHit = {
  matchedTerm: string
  number: number
  title: string
  url: string
}

export function buildSupersessionSearchArgs(repo: string, term: string): string[] {
  return [
    'issue',
    'list',
    '--repo',
    repo,
    '--search',
    term,
    '--state',
    'open',
    '--json',
    'number,title,url',
    '--limit',
    '10',
  ]
}

type RawSupersessionCandidate = { number: number; title: string; url: string }

/**
 * Queries one removed-surface term at a time so each hit retains exact per-term attribution.
 * Makes zero calls when `terms` is empty.
 */
export async function findSupersessionHits(
  runGh: RunTextCommand,
  repo: string,
  terms: readonly string[],
): Promise<SupersessionHit[]> {
  const byNumber = new Map<number, SupersessionHit>()

  for (const term of terms) {
    // oxlint-disable-next-line no-await-in-loop -- sequential to preserve first-matched-term attribution
    const json = await runGh(buildSupersessionSearchArgs(repo, term))
    const candidates = JSON.parse(json) as RawSupersessionCandidate[]
    for (const candidate of candidates) {
      if (!byNumber.has(candidate.number)) {
        byNumber.set(candidate.number, { matchedTerm: term, ...candidate })
      }
    }
  }

  return [...byNumber.values()]
}

export type SupersessionDecision =
  | { decision: 'close'; number: number }
  | ({ decision: 'keep-open' } & IssueAuditKeepOpenDecision)

export function parseAuditDecisions(
  body: string,
  validClassifications?: ReadonlySet<string>,
): SupersessionDecision[] {
  const closes: SupersessionDecision[] = parseClosingIssueReferences(body).map((ref) => ({
    decision: 'close',
    number: ref.number,
  }))
  const keepOpen: SupersessionDecision[] = parseIssueAuditKeepOpenDecisions(
    body,
    validClassifications,
  ).map((decision) => ({
    decision: 'keep-open',
    ...decision,
  }))
  return [...closes, ...keepOpen]
}

function closesAuditedRepo(ref: ClosingIssueReference, repo: string): boolean {
  if (ref.owner === undefined || ref.repo === undefined) return true
  return `${ref.owner}/${ref.repo}` === repo.toLowerCase()
}

export function validateAuditHits(
  repo: string,
  hits: readonly SupersessionHit[],
  decisions: readonly SupersessionDecision[],
  closingRefs: readonly ClosingIssueReference[],
): string[] {
  const closedNumbers = new Set<number>()
  for (const ref of closingRefs) {
    if (closesAuditedRepo(ref, repo)) closedNumbers.add(ref.number)
  }
  const keptOpenNumbers = new Set<number>()
  for (const decision of decisions) {
    if (decision.decision !== 'keep-open') continue
    if (decision.repo !== undefined && decision.repo !== repo.toLowerCase()) continue
    keptOpenNumbers.add(decision.number)
  }

  const errors: string[] = []
  for (const hit of hits) {
    if (closedNumbers.has(hit.number) || keptOpenNumbers.has(hit.number)) continue
    errors.push(
      `#${hit.number} ("${hit.title}") matches removed surface "${hit.matchedTerm}" and may be ` +
        `superseded by this PR. Add "Closes #${hit.number}" if this PR resolves it, or ` +
        `${formatIssueAuditMarkerHint(`#${hit.number}`)} if it should stay open.`,
    )
  }

  return errors
}

export function createSupersessionAuditor(
  runGh: RunTextCommand,
  repo: string,
  summary: DiffSummary,
  readPackageJson: PackageJsonReader,
  options: SupersessionAuditOptions = {},
): (body: string, closingRefs: ClosingIssueReference[]) => Promise<string[]> {
  return async (body, closingRefs) => {
    const terms = await buildRemovalTerms(summary, readPackageJson, options)
    if (terms.length === 0) return []
    const hits = await findSupersessionHits(runGh, repo, terms)
    return validateAuditHits(
      repo,
      hits,
      parseAuditDecisions(body, options.validClassifications),
      closingRefs,
    )
  }
}

export async function runAdvisorySupersessionSearch(
  runGh: RunTextCommand,
  repo: string,
  summary: DiffSummary,
  readPackageJson: PackageJsonReader,
  options: SupersessionVocabularyOptions = {},
): Promise<string> {
  const terms = await buildRemovalTerms(summary, readPackageJson, options)
  if (terms.length === 0) return ''
  return formatRelatedIssueHints(await findSupersessionHits(runGh, repo, terms))
}
