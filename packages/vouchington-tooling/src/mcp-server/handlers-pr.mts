import { hostname, userInfo } from 'node:os'
import { validateGitHubBodyLength } from '../gh-cli/body-length.mts'
import type { RunTextCommand } from '../gh-cli/exec.mts'
import { createPullRequest } from '../gh-cli/pr-create.mts'
import type { Args } from './args.mts'
import { assertPolicyAllowed, type ToolContext, type ToolHandler } from './context.mts'
import { runValidator, type PolicyRun } from './policy-run.mts'
import { renderPullRequestBody, worktreeLabel } from './pr-body.mts'
import { pullRequestNumber, withBodyFile } from './pr-body-file.mts'
import { pullRequestDefaults } from './pr-defaults.mts'
import { createGhRunner, ghEnvironment } from './pr-gh.mts'
import {
  checkTitleLength,
  positiveInteger,
  readPullRequestInput,
  type PullRequestInput,
} from './pr-input.mts'
import { preserveShepherdJournal } from './pr-journal.mts'
import {
  assertJournalUnchanged,
  credentials,
  liveBase,
  livePullRequest,
  redactCredentials,
} from './pr-live.mts'
import { parseWorktreeList } from './worktree.mts'

type Prepared = {
  input: PullRequestInput
  head: string
  body: string
  errors: string[]
  warnings: string[]
  /** The live body the update was prepared from. */
  liveBody?: string
}

function gitIn(context: ToolContext): RunTextCommand {
  return (args) => context.runGit(['-C', context.worktree, ...args])
}

function ghIn(context: ToolContext): RunTextCommand {
  const run = context.runGh ?? createGhRunner(context.env)
  const env = ghEnvironment(context.env)
  return (args) => run(args, { cwd: context.worktree, env })
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

function readPr(args: Args, required: boolean): number | undefined {
  if (args.pr === undefined && !required) return undefined
  return positiveInteger(args.pr, 'pr')
}

function policyFor(context: ToolContext): Omit<PolicyRun, 'export' | 'input'> {
  return {
    worktree: context.worktree,
    env: context.env,
    ...(context.spawnPolicy === undefined ? {} : { spawn: context.spawnPolicy }),
  }
}

/** Renders the body, preserves the live journal for an update, and runs the policy validator. */
async function prepare(
  args: Args,
  context: ToolContext,
  pr: number | undefined,
): Promise<Prepared> {
  assertPolicyAllowed(context)
  // No server credential may reach the policy or gh, whatever the caller wrote: every field is
  // redacted before anything is rendered or forwarded.
  const secrets = credentials(context.env)
  const given = redactCredentials(readPullRequestInput(args), secrets)
  checkTitleLength(given.title)
  const git = gitIn(context)
  const head = await currentBranch(git)
  // The branch name comes from the repository and is passed to gh as is, so it cannot be redacted.
  if (secrets.some((secret) => head.includes(secret)))
    throw new Error('the worktree branch name contains a server credential: rename the branch')
  const live = pr === undefined ? undefined : await livePullRequest(ghIn(context), pr)
  if (live !== undefined && live.headRefName !== head)
    throw new Error(
      `pull request ${pr} has head ${live.headRefName}, not the worktree branch ${head}`,
    )
  const base =
    live === undefined
      ? given.base
      : liveBase(pr as number, live, redactCredentials(args.base as string | undefined, secrets))
  const input = { ...given, base }
  if (head === base) throw new Error(`head branch ${head} must differ from base ${base}`)
  const device = (context.device ?? (() => ({ user: userInfo().username, host: hostname() })))()
  let body = renderPullRequestBody(input, {
    sessionId: context.sessionId,
    ...device,
    worktree: await label(context, git),
  })
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

function rejectErrors(prepared: Prepared): void {
  if (prepared.errors.length)
    throw new Error(`policy rejected the pull request:\n- ${prepared.errors.join('\n- ')}`)
}

export const handlePrValidate: ToolHandler = async (args, context) => {
  const { body, errors, warnings } = await prepare(args, context, readPr(args, false))
  return { body, errors, warnings }
}

export const handlePrCreate: ToolHandler = async (args, context) => {
  const prepared = await prepare(args, context, undefined)
  rejectErrors(prepared)
  const { input, head, body } = prepared
  const defaults = await pullRequestDefaults(policyFor(context), input)
  const url = await withBodyFile(body, (bodyFile) =>
    createPullRequest(
      { runGh: ghIn(context), runGit: gitIn(context) },
      {
        bodyFile,
        draft: true,
        title: input.title,
        base: input.base,
        head,
        labels: defaults.labels,
        ...(defaults.milestone === undefined ? {} : { milestone: defaults.milestone }),
        ...(defaults.project === undefined ? {} : { projects: [defaults.project] }),
      },
    ),
  )
  return { number: pullRequestNumber(url), url, warnings: prepared.warnings }
}

export const handlePrUpdate: ToolHandler = async (args, context) => {
  const pr = readPr(args, true) as number
  const prepared = await prepare(args, context, pr)
  rejectErrors(prepared)
  await assertJournalUnchanged(ghIn(context), pr, prepared.liveBody as string, prepared.input.base)
  const url = await withBodyFile(prepared.body, async (bodyFile) =>
    (
      await ghIn(context)([
        'pr',
        'edit',
        String(pr),
        '--title',
        prepared.input.title,
        '--body-file',
        bodyFile,
      ])
    ).trim(),
  )
  return { number: pr, url, warnings: prepared.warnings }
}
