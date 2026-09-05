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
 * Confirms `branch` has a matching ref on `remote` (default `origin`) via
 * `git ls-remote --heads`. `ls-remote --heads` exits `0` with empty stdout when there is no
 * match, so this checks stdout rather than the exit code.
 */
export async function assertHeadPushed(
  runGit: RunTextCommand,
  { branch, remote = 'origin' }: AssertHeadPushedOptions,
): Promise<void> {
  const stdout = await runGit(['ls-remote', '--heads', remote, branch])
  if (stdout.trim() === '') throw new HeadNotPushedError(branch, remote)
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
