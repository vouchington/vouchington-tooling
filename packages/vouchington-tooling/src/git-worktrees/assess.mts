import { git, run, type RunOptions } from './run.mts'

const FINISHED = new Set(['MERGED', 'CLOSED'])

interface PullRequest {
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

/** GH_REPO and GH_HOST must not redirect the lookup away from the main checkout's repository. */
function runGh(args: readonly string[], main: RunOptions): string | undefined {
  const { GH_REPO: _repo, GH_HOST: _host, ...env } = main.env
  return run('gh', args, { cwd: main.cwd, env })
}

export function readRepository(main: RunOptions): string | undefined {
  const repo = parseJson(runGh(['repo', 'view', '--json', 'nameWithOwner'], main)) as
    | { nameWithOwner?: string }
    | undefined
  return repo?.nameWithOwner?.toLowerCase()
}

/** Clean status, no hidden index entries, and nothing unpushed. Returns the HEAD commit or a reason. */
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
  const unpushed = git(['rev-list', 'HEAD', '--not', '--remotes'], worktree)
  if (unpushed === undefined) return { reason: 'cannot read unpushed commits' }
  if (unpushed.trim() !== '') return { reason: 'unpushed commits' }
  return { head }
}

/** Needs a merged or closed same-repository PR for this branch whose head is exactly HEAD. */
export function assessPullRequest(
  branch: string,
  head: string,
  repository: string | undefined,
  main: RunOptions,
): string | undefined {
  if (repository === undefined) return 'cannot read repository'
  const fields = 'state,headRefOid,isCrossRepository,headRepository,headRepositoryOwner'
  const listed = parseJson(
    runGh(
      ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '100', '--json', fields],
      main,
    ),
  )
  if (!Array.isArray(listed)) return 'cannot read PR state'
  const own = (listed as PullRequest[]).filter(
    (pr) =>
      pr.isCrossRepository === false &&
      `${pr.headRepositoryOwner?.login}/${pr.headRepository?.name}`.toLowerCase() === repository,
  )
  if (own.some((pr) => pr.state === 'OPEN')) return 'open PR'
  const finished = own.filter((pr) => FINISHED.has(pr.state as string))
  if (finished.length === 0) return 'no finished PR from this repository'
  if (!finished.some((pr) => pr.headRefOid === head)) return 'PR head differs from HEAD'
  return undefined
}
