import { hostname, userInfo } from 'node:os'
import { validateGitHubBodyLength } from '../gh-cli/body-length.mts'
import type { RunTextCommand } from '../gh-cli/exec.mts'
import type { Args } from './args.mts'
import { assertPolicyAllowed, type ToolContext } from './context.mts'
import type { PolicyRun } from './policy-run.mts'
import { renderPullRequestBody, worktreeLabel } from './pr-body.mts'
import { createGhRunner, ghEnvironment } from './pr-gh.mts'
import { checkTitleLength, readPullRequestInput, type PullRequestInput } from './pr-input.mts'
import { preserveShepherdJournal } from './pr-journal.mts'
import {
  credentials,
  type LivePullRequest,
  liveBase,
  livePullRequest,
  readLivePullRequest,
  redactCredentials,
} from './pr-live.mts'
import { noSourceStatement } from './pr-no-source.mts'
import { runValidator } from './policy-run.mts'
import { parseWorktreeList } from './worktree.mts'

export type Prepared = {
  input: PullRequestInput
  head: string
  body: string
  errors: string[]
  warnings: string[]
  /** The live body the update was prepared from. */
  liveBody?: string
}

/**
 * `create` has no live pull request. `update` requires one that is OPEN and whose head is the
 * worktree branch. `validate` only reads one, of any state and head, for its Shepherd Journal,
 * base and head.
 */
export type PrepareKind = 'create' | 'update' | 'validate'

export function gitIn(context: ToolContext): RunTextCommand {
  return (args) => context.runGit(['-C', context.worktree, ...args])
}

export function ghIn(context: ToolContext): RunTextCommand {
  const run = context.runGh ?? createGhRunner(context.env)
  const env = ghEnvironment(context.env)
  return (args) => run(args, { cwd: context.worktree, env })
}

export function policyFor(context: ToolContext): Omit<PolicyRun, 'export' | 'input'> {
  return {
    worktree: context.worktree,
    env: context.env,
    ...(context.spawnPolicy === undefined ? {} : { spawn: context.spawnPolicy }),
  }
}

async function currentBranch(git: RunTextCommand): Promise<string> {
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (branch === 'HEAD') throw new Error('the worktree has a detached HEAD: check out a branch')
  return branch
}

async function label(context: ToolContext, git: RunTextCommand): Promise<string> {
  const listing = await git(['worktree', 'list', '--porcelain', '-z'])
  return worktreeLabel(context.worktree, parseWorktreeList(listing)[0])
}

async function liveFor(kind: PrepareKind, context: ToolContext, pr: number | undefined) {
  if (pr === undefined) return undefined
  return kind === 'update'
    ? livePullRequest(ghIn(context), pr)
    : readLivePullRequest(ghIn(context), pr)
}

/**
 * The head to validate. An update accepts the worktree branch, or an alias branch whose HEAD is
 * the live head commit, and then uses the live head name; anything else is rejected.
 */
async function headFor(
  kind: PrepareKind,
  git: RunTextCommand,
  live: LivePullRequest | undefined,
  pr: number | undefined,
  worktreeHead: string | undefined,
): Promise<string> {
  if (worktreeHead === undefined) return (live as LivePullRequest).headRefName
  if (live === undefined || kind !== 'update' || live.headRefName === worktreeHead)
    return worktreeHead
  const sha = (await git(['rev-parse', 'HEAD'])).trim()
  if (sha !== live.headRefOid)
    throw new Error(
      `pull request ${pr} has head ${live.headRefName} at ${live.headRefOid}, not the worktree branch ${worktreeHead} at ${sha}`,
    )
  return live.headRefName
}

/** Renders the body, preserves the live journal for an update, and runs the policy validator. */
export async function prepare(
  args: Args,
  context: ToolContext,
  kind: PrepareKind,
  pr: number | undefined,
): Promise<Prepared> {
  assertPolicyAllowed(context)
  // No server credential may reach the policy or gh, whatever the caller wrote: every field is
  // redacted before anything is rendered or forwarded.
  const secrets = credentials(context.env)
  const given = redactCredentials(readPullRequestInput(args, context.env), secrets)
  checkTitleLength(given.title)
  const git = gitIn(context)
  const live = await liveFor(kind, context, pr)
  // A read-only validation of an existing pull request judges the head that pull request has.
  const worktreeHead =
    live !== undefined && kind === 'validate' ? undefined : await currentBranch(git)
  // The local branch is checked before any diagnostic or alias resolution can echo or drop it.
  if (worktreeHead !== undefined && secrets.some((secret) => worktreeHead.includes(secret)))
    throw new Error('the worktree branch name contains a server credential: rename the branch')
  const head = await headFor(kind, git, live, pr, worktreeHead)
  // Branch names are refs passed to gh as is: redacting one would name a branch that does not exist.
  if (secrets.some((secret) => head.includes(secret)))
    throw new Error('the worktree branch name contains a server credential: rename the branch')
  if (secrets.some((secret) => (args.base as string | undefined)?.includes(secret)))
    throw new Error('base contains a server credential: use another base branch')
  const base =
    live === undefined
      ? given.base
      : liveBase(pr as number, live, redactCredentials(args.base as string | undefined, secrets))
  const input = { ...given, base }
  // A live pull request may come from a fork whose branch shares the base's name.
  if (head === base && !(kind === 'validate' && live !== undefined))
    throw new Error(`head branch ${head} must differ from base ${base}`)
  const device = (context.device ?? (() => ({ user: userInfo().username, host: hostname() })))()
  const statement = await noSourceStatement(policyFor(context), input)
  let body = renderPullRequestBody(
    input,
    { sessionId: context.sessionId, ...device, worktree: await label(context, git) },
    statement,
  )
  if (live !== undefined) body = preserveShepherdJournal(body, live.body)
  body = redactCredentials(body, secrets)
  const length = validateGitHubBodyLength(body)
  if (!length.ok)
    throw new Error(
      `the rendered body has ${length.characterCount} characters; GitHub allows ${length.maxCharacterCount}`,
    )
  const report = await runValidator({
    ...policyFor(context),
    export: 'validatePullRequest',
    input: {
      title: input.title,
      body,
      base: input.base,
      head,
      mode: input.mode,
      ...(input.noSourceIssue === undefined ? {} : { noSourceIssue: input.noSourceIssue }),
      ...(pr === undefined ? {} : { pr }),
    },
  })
  const errors = 'errors' in report ? report.errors : []
  const warnings = 'warnings' in report ? report.warnings : []
  return {
    input,
    head,
    body,
    errors,
    warnings,
    ...(live === undefined ? {} : { liveBody: live.body }),
  }
}
