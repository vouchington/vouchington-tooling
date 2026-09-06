import type { RunTextCommand } from './exec.mts'

/** Thrown by {@link resolveHeadBranch} when `git branch --show-current` reports a detached HEAD. */
export class DetachedHeadError extends Error {
  constructor() {
    super('cannot resolve a pull request head branch from a detached HEAD')
    this.name = 'DetachedHeadError'
  }
}

/** Thrown by {@link assertHeadPushed} when the branch has no matching ref on the remote. */
export class HeadNotPushedError extends Error {
  constructor(branch: string, remote: string) {
    super(
      `branch "${branch}" is not on remote "${remote}" — push it before creating the pull request`,
    )
    this.name = 'HeadNotPushedError'
  }
}

/**
 * Thrown by {@link assertHeadPushed} when `branch` exists on `remote` but at a different commit
 * than the local branch — creating the pull request now would silently use the stale remote tip.
 */
export class HeadOutOfDateError extends Error {
  constructor(branch: string, remote: string) {
    super(
      `branch "${branch}" on remote "${remote}" does not match the local branch — push the latest commits before creating the pull request`,
    )
    this.name = 'HeadOutOfDateError'
  }
}

/** Resolves the current branch via `git branch --show-current`, trimmed. */
export async function resolveHeadBranch(runGit: RunTextCommand): Promise<string> {
  const branch = (await runGit(['branch', '--show-current'])).trim()
  if (branch === '') throw new DetachedHeadError()
  return branch
}

export type AssertHeadPushedOptions = {
  branch: string
  remote?: string
}

/**
 * Confirms `branch` has a matching, up-to-date ref on `remote` (default `origin`) via
 * `git ls-remote --heads` and `git rev-parse`. `ls-remote --heads` exits `0` with empty stdout
 * when there is no match, so a missing branch is checked via stdout rather than the exit code.
 * A remote ref that exists but points at a different commit than the local branch means local
 * HEAD has commits the remote does not — that fails with {@link HeadOutOfDateError} rather than
 * silently creating the pull request from the stale remote tip.
 */
export async function assertHeadPushed(
  runGit: RunTextCommand,
  { branch, remote = 'origin' }: AssertHeadPushedOptions,
): Promise<void> {
  const remoteLine = (await runGit(['ls-remote', '--heads', remote, branch])).trim()
  if (remoteLine === '') throw new HeadNotPushedError(branch, remote)
  const [remoteSha] = remoteLine.split(/\s+/)
  const localSha = (await runGit(['rev-parse', branch])).trim()
  if (localSha !== remoteSha) throw new HeadOutOfDateError(branch, remote)
}

export type BuildGhPrCreateArgsOptions = {
  base?: string
  bodyFile: string
  draft?: boolean
  head: string
  labels?: readonly string[]
  reviewers?: readonly string[]
  title: string
}

/** Pure argv builder for `gh pr create`. `head` is always passed explicitly (never omitted). */
export function buildGhPrCreateArgs(options: BuildGhPrCreateArgsOptions): string[] {
  const { base, bodyFile, draft = false, head, labels = [], reviewers = [], title } = options
  const args = ['pr', 'create', '--title', title, '--body-file', bodyFile, '--head', head]
  if (base !== undefined) args.push('--base', base)
  if (draft) args.push('--draft')
  for (const label of labels) args.push('--label', label)
  for (const reviewer of reviewers) args.push('--reviewer', reviewer)
  return args
}

export type CreatePullRequestExecutors = {
  runGh: RunTextCommand
  runGit: RunTextCommand
}

export type CreatePullRequestOptions = Omit<BuildGhPrCreateArgsOptions, 'head'> & {
  head?: string
  remote?: string
}

/**
 * Creates a pull request with `gh pr create --head <branch>`, resolving and verifying the head
 * branch first so the "must first push the current branch" non-interactive abort can never
 * happen — instead an unpushed branch fails fast with {@link HeadNotPushedError}. Returns the
 * trimmed PR URL that `gh pr create` prints to stdout.
 */
export async function createPullRequest(
  { runGh, runGit }: CreatePullRequestExecutors,
  options: CreatePullRequestOptions,
): Promise<string> {
  const { remote = 'origin', head: suppliedHead, ...rest } = options
  const head = suppliedHead ?? (await resolveHeadBranch(runGit))
  await assertHeadPushed(runGit, { branch: head, remote })
  const stdout = await runGh(buildGhPrCreateArgs({ ...rest, head }))
  return stdout.trim()
}
