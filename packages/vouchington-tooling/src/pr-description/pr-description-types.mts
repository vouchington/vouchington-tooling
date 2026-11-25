import type { ClosingIssueReference } from '../gh-cli/index.mts'
import type { DiffLineChanges } from '../pull-request-diff/index.mts'

export type ReferencedIssue = {
  body: string
  isPullRequest: boolean
  milestone: string | undefined
  number: number
  state: string
  title: string
  url: string
}

export type IssueReferenceLookup =
  | { issue: ReferencedIssue; ok: true }
  | { error: string; ok: false }

export type IssueReferenceResolver = (ref: ClosingIssueReference) => Promise<IssueReferenceLookup>

/**
 * `repo === undefined` means the closing ref named no explicit owner/repo, i.e. it closes an issue
 * in the audited repo itself. An explicit `Closes owner/other#N` carries that lowercased string so
 * auditors can key by `(repo, ...)` without re-deriving it from `ClosingIssueReference`.
 */
export type ClosingIssueForAudit = {
  issue: ReferencedIssue
  repo: string | undefined
}

export type PullRequestIdentity = {
  mergeCommitOid: string | undefined
  number: number
  owner: string
  repo: string
  state: string
}

export type PullRequestReference = Pick<PullRequestIdentity, 'number' | 'owner' | 'repo'>

export type PullRequestRefOids = {
  baseRefOid: string
  headRefOid: string
}

export type ClosureLookup =
  | { closer: PullRequestReference | null; ok: true }
  | { error: string; ok: false }

export type IssueClosureResolver = (ref: ClosingIssueReference) => Promise<ClosureLookup>

export type RemovedSurface =
  | { path: string; type: 'deleted-file' }
  | { name: string; path: string; type: 'removed-export' }
  | { path: string; route: string; type: 'removed-route' }
  | { name: string; path: string; type: 'removed-script' }

export type RoutePathParser = (path: string) => string | undefined

export type DiffSummary = {
  changedPackageJsonPaths: string[]
  lineChanges: DiffLineChanges
  removedSurfaces: RemovedSurface[]
}

/**
 * Reads one side of a `package.json` at `path`. `undefined` means unavailable (missing on that side
 * or transient read failure); callers treat it as empty `scripts` rather than throwing.
 */
export type PackageJsonReader = (path: string, side: 'base' | 'head') => Promise<string | undefined>
