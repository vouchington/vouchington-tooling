import type { RunTextCommand } from '../gh-cli/exec.mts'

export type LivePullRequest = {
  body: string
  headRefName: string
  baseRefName: string
  state: string
}

const FIELDS = ['body', 'headRefName', 'baseRefName', 'state'] as const

/** The live pull request as gh reports it, rejected unless it is open. */
export async function livePullRequest(gh: RunTextCommand, pr: number): Promise<LivePullRequest> {
  const output = await gh(['pr', 'view', String(pr), '--json', FIELDS.join(',')])
  const live = JSON.parse(output) as Partial<Record<(typeof FIELDS)[number], unknown>> | null
  if (!isLive(live)) throw new Error(`gh pr view ${pr} did not return ${FIELDS.join(', ')}`)
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

/** Replaces the server's blackboard token in every string of a JSON-shaped value. */
export function redactToken<T>(value: T, token: string | undefined): T {
  if (value === undefined || token === undefined || token.length < 4) return value
  const escaped = JSON.stringify(token).slice(1, -1)
  return JSON.parse(JSON.stringify(value).split(escaped).join('[REDACTED]')) as T
}
