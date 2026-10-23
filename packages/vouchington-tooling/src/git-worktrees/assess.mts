import { git, LOCAL_ENV, run, withoutVariables, type RunOptions } from './run.mts'

const FINISHED = new Set(['MERGED', 'CLOSED'])

export interface PullRequest {
  readonly headRefName?: string
  readonly state?: string
  readonly headRefOid?: string
  readonly isCrossRepository?: boolean
  readonly headRepository?: { readonly name?: string } | null
  readonly headRepositoryOwner?: { readonly login?: string } | null
}

export type Assessment = { readonly head: string } | { readonly reason: string }

function parseJson(text: string | undefined): unknown {
  try {
    return text === undefined ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Repo-local git variables, GH_REPO and GH_HOST must not redirect the lookup away from the main checkout. */
function runGh(args: readonly string[], main: RunOptions): string | undefined {
  const env = withoutVariables(main.env, [...LOCAL_ENV, 'GH_REPO', 'GH_HOST'])
  return run('gh', args, { ...main, env })
}

export function readRepository(main: RunOptions): string | undefined {
  const repo = parseJson(runGh(['repo', 'view', '--json', 'nameWithOwner'], main)) as
    | { nameWithOwner?: string }
    | undefined
  return repo?.nameWithOwner?.toLowerCase()
}

/** Clean status and no hidden index entries. Returns the HEAD commit or a reason. */
export function assessLocal(worktree: RunOptions): Assessment {
  const status = git(
    ['status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none'],
    worktree,
  )
  if (status === undefined) return { reason: 'cannot read status' }
  if (status !== '') return { reason: 'uncommitted changes' }
  const files = git(['ls-files', '-v', '-z'], worktree)
  if (files === undefined) return { reason: 'cannot read index' }
  if (files.split('\0').some((entry) => /^[a-zS]/.test(entry))) {
    return { reason: 'hidden index entries (assume-unchanged or skip-worktree)' }
  }
  const headOutput = git(['rev-parse', 'HEAD'], worktree)
  if (headOutput === undefined) return { reason: 'cannot read HEAD' }
  const head = headOutput.trim()
  return { head }
}

const PAGE = 1000

function listPulls(
  branch: string | undefined,
  state: string,
  main: RunOptions,
  limit = PAGE,
): PullRequest[] | undefined {
  const fields = 'state,headRefName,headRefOid,isCrossRepository,headRepository,headRepositoryOwner'
  const args = ['pr', 'list', '--state', state, '--limit', String(limit)]
  if (branch !== undefined) args.push('--head', branch)
  const listed = parseJson(runGh([...args, '--json', fields], main))
  return Array.isArray(listed) &&
    (listed.length < limit || (branch === undefined && state === 'all'))
    ? (listed as PullRequest[])
    : undefined
}

/**
 * Needs a merged or closed same-repository PR for this branch whose head is exactly HEAD. That
 * also proves HEAD is published on GitHub, so deleted branches (squash merges) need no remote ref.
 */
export function assessPullRequest(
  branch: string,
  head: string,
  repository: string | undefined,
  main: RunOptions,
): string | undefined {
  if (repository === undefined) return 'cannot read repository'
  // Open PRs are queried on their own so a long history cannot hide one; a full page is unreadable.
  const open = listPulls(branch, 'open', main)
  const all = listPulls(branch, 'all', main)
  if (open === undefined || all === undefined) return 'cannot read PR state'
  return assessListedPulls([...open, ...all], branch, head, repository)
}

/** A complete open list protects active branches; bounded recent history only proves candidates. */
export function readPullSnapshot(
  main: RunOptions,
  limit: number,
): readonly PullRequest[] | undefined {
  const open = listPulls(undefined, 'open', main, limit)
  const all = listPulls(undefined, 'all', main, limit)
  return open === undefined || all === undefined ? undefined : [...open, ...all]
}

export function assessListedPulls(
  pulls: readonly PullRequest[] | undefined,
  branch: string,
  head: string,
  repository: string | undefined,
): string | undefined {
  if (repository === undefined) return 'cannot read repository'
  if (pulls === undefined) return 'cannot read PR state'
  const own = pulls.filter(
    (pr) =>
      pr.headRefName === branch &&
      pr.isCrossRepository === false &&
      `${pr.headRepositoryOwner?.login}/${pr.headRepository?.name}`.toLowerCase() === repository,
  )
  if (own.some((pr) => pr.state === 'OPEN')) return 'open PR'
  const finished = own.filter((pr) => FINISHED.has(pr.state as string))
  if (finished.length === 0) return 'no finished PR from this repository'
  if (!finished.some((pr) => pr.headRefOid === head)) return 'PR head differs from HEAD'
  return undefined
}
