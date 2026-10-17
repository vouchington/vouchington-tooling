import type { RunTextCommand } from '../gh-cli/exec.mts'
import { findShepherdJournal } from './pr-journal.mts'

export type LivePullRequest = {
  body: string
  headRefName: string
  headRefOid: string
  baseRefName: string
  state: string
}

const FIELDS = ['body', 'headRefName', 'headRefOid', 'baseRefName', 'state'] as const

/** The live pull request as gh reports it, whatever its state. */
export async function readLivePullRequest(
  gh: RunTextCommand,
  pr: number,
): Promise<LivePullRequest> {
  const output = await gh(['pr', 'view', String(pr), '--json', FIELDS.join(',')])
  const live = JSON.parse(output) as Partial<Record<(typeof FIELDS)[number], unknown>> | null
  if (!isLive(live)) throw new Error(`gh pr view ${pr} did not return ${FIELDS.join(', ')}`)
  return live
}

/** The live pull request, rejected unless it is open. */
export async function livePullRequest(gh: RunTextCommand, pr: number): Promise<LivePullRequest> {
  const live = await readLivePullRequest(gh, pr)
  // A closed or merged PR can share a reused branch name; its history must not be rewritten.
  if (live.state !== 'OPEN') throw new Error(`pull request ${pr} is ${live.state}, not OPEN`)
  return live
}

function isLive(value: Partial<Record<string, unknown>> | null): value is LivePullRequest {
  return FIELDS.every((field) => typeof value?.[field] === 'string')
}

/**
 * The base to validate an existing pull request against: its live base. An explicit `base` that
 * differs is rejected, because `gh pr edit` here changes only the title and body.
 */
export function liveBase(pr: number, live: LivePullRequest, given: string | undefined): string {
  if (given !== undefined && given !== live.baseRefName)
    throw new Error(`pull request ${pr} targets ${live.baseRefName}, not ${given}`)
  return live.baseRefName
}

/**
 * Re-reads the live pull request just before the edit and aborts if its Shepherd Journal or base
 * changed since the body was prepared and validated, so an entry appended in between is never
 * overwritten and a retargeted PR never gets a body validated against its old base.
 */
export async function assertJournalUnchanged(
  gh: RunTextCommand,
  pr: number,
  preparedFrom: string,
  base: string,
): Promise<void> {
  const now = await livePullRequest(gh, pr)
  if (now.baseRefName !== base)
    throw new Error(`pull request ${pr} was retargeted to ${now.baseRefName}; run pr_update again`)
  if (findShepherdJournal(now.body) !== findShepherdJournal(preparedFrom))
    throw new Error(
      `the Shepherd Journal of pull request ${pr} changed meanwhile; run pr_update again`,
    )
}

/** The server's credential values that must never reach the policy or GitHub, longest first. */
export function credentials(env: NodeJS.ProcessEnv): string[] {
  const values = [env.AGENT_BLACKBOARD_TOKEN, env.GH_TOKEN, env.GITHUB_TOKEN].filter(
    (value): value is string => value !== undefined && value.length >= 4,
  )
  return [...new Set(values)].sort((a, b) => b.length - a.length)
}

/** Replaces every server credential in every string of a JSON-shaped value. */
export function redactCredentials<T>(value: T, secrets: string[]): T {
  if (value === undefined || secrets.length === 0) return value
  const json = secrets.reduce(
    (text, secret) => text.split(JSON.stringify(secret).slice(1, -1)).join('[REDACTED]'),
    JSON.stringify(value),
  )
  return JSON.parse(json) as T
}
