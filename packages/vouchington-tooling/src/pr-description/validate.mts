import { parseClosingIssueReferences, type ClosingIssueReference } from '../gh-cli/index.mts'
import { validateResolvedIssueReferences } from './closing-refs.mts'
import { extractPartialBatchSourceRef, validatePartialBatchSourceRef } from './no-source.mts'
import type {
  ClosingIssueForAudit,
  IssueClosureResolver,
  IssueReferenceLookup,
  IssueReferenceResolver,
  PullRequestIdentity,
} from './pr-description-types.mts'
import {
  validatePrBody,
  type PrBodyValidationOptions,
  type PrBodyValidationResult,
} from './validate-body.mts'

export type IssueReferenceValidationOptions = PrBodyValidationOptions & {
  closureResolver?: IssueClosureResolver
  milestoneAuditor?: (
    body: string,
    closingRefs: ClosingIssueReference[],
    closingIssues: ClosingIssueForAudit[],
  ) => Promise<string[]>
  projectAuditor?: (closingIssues: ClosingIssueForAudit[]) => Promise<string[]>
  supersessionAuditor?: (body: string, closingRefs: ClosingIssueReference[]) => Promise<string[]>
  targetPullRequest?: PullRequestIdentity
}

async function resolveAllowedClosedReferences(
  refs: readonly ClosingIssueReference[],
  lookups: ReadonlyMap<string, IssueReferenceLookup>,
  target: PullRequestIdentity | undefined,
  closureResolver: IssueClosureResolver | undefined,
): Promise<Set<string>> {
  const allowed = new Set<string>()
  if (target?.state.toUpperCase() !== 'MERGED' || closureResolver === undefined) return allowed
  await Promise.all(
    refs.map(async (ref) => {
      const lookup = lookups.get(ref.key)
      if (lookup?.ok !== true || lookup.issue.state.toLowerCase() === 'open') return
      const closure = await closureResolver(ref)
      if (
        closure.ok === true &&
        closure.closer !== null &&
        closure.closer.number === target.number &&
        closure.closer.owner.toLowerCase() === target.owner.toLowerCase() &&
        closure.closer.repo.toLowerCase() === target.repo.toLowerCase()
      ) {
        allowed.add(ref.key)
      }
    }),
  )
  return allowed
}

function collectClosingIssuesForAudit(
  refs: readonly ClosingIssueReference[],
  lookups: ReadonlyMap<string, IssueReferenceLookup>,
  allowedClosedReferences: ReadonlySet<string>,
): ClosingIssueForAudit[] {
  const closingIssues: ClosingIssueForAudit[] = []
  for (const ref of refs) {
    const lookup = lookups.get(ref.key)
    if (lookup?.ok !== true) continue
    const isOpen = lookup.issue.state.toLowerCase() === 'open'
    if (isOpen || allowedClosedReferences.has(ref.key)) {
      const repo =
        ref.owner !== undefined && ref.repo !== undefined ? `${ref.owner}/${ref.repo}` : undefined
      closingIssues.push({ issue: lookup.issue, repo })
    }
  }
  return closingIssues
}

export async function validatePrBodyWithIssueReferences(
  body: string,
  resolveIssueReference: IssueReferenceResolver,
  options: IssueReferenceValidationOptions = {},
): Promise<PrBodyValidationResult> {
  const result = validatePrBody(body, options)
  if (!result.ok) return result

  const refs = parseClosingIssueReferences(body)
  const lookups = new Map<string, IssueReferenceLookup>()
  await Promise.all(
    refs.map(async (ref) => {
      lookups.set(ref.key, await resolveIssueReference(ref))
    }),
  )

  const target = options.targetPullRequest
  const targetIsMerged = target?.state.toUpperCase() === 'MERGED'

  const partialTemplate = options.policy?.partialBatch
  const partialSourceRef =
    partialTemplate === undefined ? undefined : extractPartialBatchSourceRef(body, partialTemplate)
  const partialSourceLookup =
    partialSourceRef === undefined ? undefined : await resolveIssueReference(partialSourceRef)
  result.errors.push(
    ...validatePartialBatchSourceRef(partialSourceRef, partialSourceLookup, targetIsMerged),
  )
  if (
    partialSourceRef !== undefined &&
    refs.some((ref) => {
      if (ref.key === partialSourceRef.key) return true
      const lookup = lookups.get(ref.key)
      return (
        lookup?.ok === true &&
        partialSourceLookup?.ok === true &&
        lookup.issue.url.toLowerCase() === partialSourceLookup.issue.url.toLowerCase()
      )
    })
  ) {
    result.errors.push('A partial batch must not also close its source issue.')
  }

  const allowedClosedReferences = await resolveAllowedClosedReferences(
    refs,
    lookups,
    target,
    options.closureResolver,
  )
  const resolved = validateResolvedIssueReferences(
    body,
    refs,
    lookups,
    allowedClosedReferences,
    targetIsMerged,
  )
  result.errors.push(...resolved.errors)
  result.referencedIssues.push(...resolved.issues)

  const closingIssues = collectClosingIssuesForAudit(refs, lookups, allowedClosedReferences)
  const [supersessionErrors, milestoneErrors, projectAdvisories] = await Promise.all([
    options.supersessionAuditor?.(body, refs) ?? Promise.resolve([]),
    options.milestoneAuditor?.(body, refs, closingIssues) ?? Promise.resolve([]),
    options.projectAuditor?.(closingIssues) ?? Promise.resolve([]),
  ])
  result.errors.push(...supersessionErrors, ...milestoneErrors)
  result.advisories = projectAdvisories
  result.ok = result.errors.length === 0
  return result
}
