import type { ClosingIssueReference, RunTextCommand } from '../gh-cli/index.mts'
import { parseGitHubIssueApiResponse } from './closing-refs.mts'
import type {
  IssueReferenceLookup,
  IssueReferenceResolver,
  ReferencedIssue,
} from './pr-description-types.mts'

export type RelatedIssueCandidate = {
  number: number
  title: string
  url: string
}

export function formatRelatedIssueHints(candidates: readonly RelatedIssueCandidate[]): string {
  if (candidates.length === 0) return ''
  return [
    'Advisory: found potentially related open issues — check if any should appear under "## Related issues":',
    ...candidates.map((candidate) => `  #${candidate.number}: ${candidate.title}`),
    '',
  ].join('\n')
}

export function formatReferencedIssueSummary(issues: readonly ReferencedIssue[]): string {
  if (issues.length === 0) return ''
  return [
    'Referenced closing issues:',
    ...issues.map((issue) => {
      const state = issue.state.toUpperCase()
      const kind = issue.isPullRequest ? 'pull request' : 'issue'
      return `  #${issue.number} ${state} ${kind}: ${issue.title}`
    }),
    '',
  ].join('\n')
}

export async function currentRepo(runGh: RunTextCommand): Promise<string> {
  const json = await runGh(['repo', 'view', '--json', 'nameWithOwner'])
  const parsed = JSON.parse(json) as { nameWithOwner?: string }
  if (parsed.nameWithOwner === undefined || parsed.nameWithOwner.trim() === '') {
    throw new Error('could not determine current GitHub repository')
  }
  return parsed.nameWithOwner
}

export async function resolveClosingIssueReference(
  ref: ClosingIssueReference,
  runGh: RunTextCommand,
  currentRepoLookup: () => Promise<string> = () => currentRepo(runGh),
): Promise<IssueReferenceLookup> {
  try {
    const repo =
      ref.owner !== undefined && ref.repo !== undefined
        ? `${ref.owner}/${ref.repo}`
        : await currentRepoLookup()
    const json = await runGh(['api', `repos/${repo}/issues/${ref.number}`])
    return { issue: parseGitHubIssueApiResponse(json), ok: true }
  } catch (err: unknown) {
    return {
      error: err instanceof Error ? err.message : String(err),
      ok: false,
    }
  }
}

export function createClosingIssueReferenceResolver(runGh: RunTextCommand): IssueReferenceResolver {
  let currentRepoPromise: Promise<string> | undefined
  return (ref: ClosingIssueReference): Promise<IssueReferenceLookup> =>
    resolveClosingIssueReference(ref, runGh, () => {
      currentRepoPromise ??= currentRepo(runGh).catch((err: unknown) => {
        currentRepoPromise = undefined
        throw err
      })
      return currentRepoPromise
    })
}
