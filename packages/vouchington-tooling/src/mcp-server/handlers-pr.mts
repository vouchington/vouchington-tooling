import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { validateGitHubBodyLength } from '../gh-cli/body-length.mts'
import type { RunTextCommand } from '../gh-cli/exec.mts'
import { createPullRequest } from '../gh-cli/pr-create.mts'
import type { Args } from './args.mts'
import { assertPolicyAllowed, type ToolContext, type ToolHandler } from './context.mts'
import { runValidator, type PolicyRun } from './policy-run.mts'
import { renderPullRequestBody, worktreeLabel } from './pr-body.mts'
import { pullRequestDefaults } from './pr-defaults.mts'
import { createGhRunner, ghEnvironment } from './pr-gh.mts'
import { positiveInteger, readPullRequestInput, type PullRequestInput } from './pr-input.mts'
import { preserveShepherdJournal } from './pr-journal.mts'
import { parseWorktreeList } from './worktree.mts'

type Prepared = {
  input: PullRequestInput
  head: string
  body: string
  errors: string[]
  warnings: string[]
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

type LivePullRequest = { body: string; headRefName: string }

async function livePullRequest(gh: RunTextCommand, pr: number): Promise<LivePullRequest> {
  const output = await gh(['pr', 'view', String(pr), '--json', 'body,headRefName'])
  const live = JSON.parse(output) as Partial<LivePullRequest> | null
  if (typeof live?.body !== 'string' || typeof live.headRefName !== 'string')
    throw new Error(`gh pr view ${pr} did not return a body and headRefName`)
  return { body: live.body, headRefName: live.headRefName }
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
  // The server's token must reach neither the policy nor gh, whatever the caller wrote.
  const token = context.env.AGENT_BLACKBOARD_TOKEN
  const redact = (text: string) =>
    token !== undefined && token.length >= 4 ? text.split(token).join('[REDACTED]') : text
  const given = readPullRequestInput(args)
  const input = { ...given, title: redact(given.title) }
  const git = gitIn(context)
  const head = await currentBranch(git)
  if (head === input.base)
    throw new Error(`head branch ${head} must differ from base ${input.base}`)
  const device = (context.device ?? (() => ({ user: userInfo().username, host: hostname() })))()
  let body = renderPullRequestBody(input, {
    sessionId: context.sessionId,
    ...device,
    worktree: await label(context, git),
  })
  if (pr !== undefined) {
    const live = await livePullRequest(ghIn(context), pr)
    if (live.headRefName !== head)
      throw new Error(
        `pull request ${pr} has head ${live.headRefName}, not the worktree branch ${head}`,
      )
    body = preserveShepherdJournal(body, live.body)
  }
  body = redact(body)
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
  return { input, head, body, errors, warnings: 'warnings' in report ? report.warnings : [] }
}

function rejectErrors(prepared: Prepared): void {
  if (prepared.errors.length)
    throw new Error(`policy rejected the pull request:\n- ${prepared.errors.join('\n- ')}`)
}

/** Writes the body to a private temp file for the duration of `use`, then removes it. */
async function withBodyFile<T>(body: string, use: (file: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'vouchington-pr-'))
  try {
    const file = join(directory, 'body.md')
    await writeFile(file, body, { mode: 0o600 })
    return await use(file)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function pullRequestNumber(url: string): number {
  const match = /\/pull\/(\d+)\s*$/.exec(url)
  if (!match) throw new Error(`could not read the pull request number from: ${url}`)
  return Number(match[1])
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
