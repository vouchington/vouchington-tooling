import {
  composeRetrospective,
  type FeedbackCoverage,
  type RetrospectiveCompositionInput,
  type WorkOutcome,
} from '../agent-blackboard/index.mts'
import type { BlackboardClientDependencies } from '../agent-blackboard/client.mts'
import { rejectUnknown, type Args } from './args.mts'
import { SESSION_ID } from '../retrospective-transcript/resolve-transcript-file.mts'
import { serverJournalLoader } from './journal-read.mts'
import { spawnPolicy, type PolicyOutcome } from './policy-spawn.mts'

const COMPOSE_KEYS = [
  'narrative',
  'date',
  'issues',
  'prs',
  'description',
  'facts',
  'transcript',
  'tools',
  'architecture',
  'knownSensitiveValues',
]
const COMPOSE_REQUIRED = COMPOSE_KEYS.filter((key) => key !== 'knownSensitiveValues')
/** No `repo`: a caller must not aim the server's GitHub token at another repository. */
const FACTS_KEYS = ['pr', 'branch', 'noPr', 'status', 'reason']
/** No path overrides: the server reads the session's transcript from its own default roots. */
const TRANSCRIPT_KEYS = ['sessionId', 'harnessSessionId', 'status', 'reason']
/** The longest a facts subprocess may run before it is killed. */
export const FACTS_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 10_000_000

type ComposeBase = {
  sessionId: string
  repositories: string[]
  workOutcome: WorkOutcome
  feedbackCoverage: FeedbackCoverage
  worktree: string
  env: NodeJS.ProcessEnv
  dependencies: BlackboardClientDependencies
}

function section(compose: Args, name: string, keys: string[]): Args {
  const value = compose[name]
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`compose.${name} must be an object`)
  rejectUnknown(value as Args, keys)
  return value as Args
}

/**
 * Facts commands run in the worktree and never see the blackboard credentials, NODE_OPTIONS, or
 * GIT_* overrides that could point git away from the validated worktree.
 */
export function worktreeExecutor(
  worktree: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number = FACTS_TIMEOUT_MS,
) {
  const safe = Object.fromEntries(
    Object.entries(env).filter(
      ([name]) =>
        !name.startsWith('AGENT_BLACKBOARD_') &&
        !name.startsWith('GIT_') &&
        name !== 'NODE_OPTIONS',
    ),
  )
  // Each command runs in its own process group, killed whole when it exits or times out, so a
  // helper that git or gh starts cannot outlive the call with an inherited GH_TOKEN.
  return async (command: string, args: string[]) => {
    let outcome: PolicyOutcome
    try {
      outcome = await spawnPolicy({
        command,
        args,
        cwd: worktree,
        env: safe,
        input: '',
        timeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      })
    } catch (error) {
      return { ok: false, stdout: '', stderr: (error as Error).message, exitCode: null }
    }
    const { stdout, stderr, exitCode, timedOut, overflowed } = outcome
    if (timedOut || overflowed) {
      const reason = timedOut
        ? `timed out after ${timeoutMs} ms`
        : `wrote more than ${MAX_OUTPUT_BYTES} bytes`
      return { ok: false, stdout, stderr: `${stderr}${command} ${reason}`, exitCode: null }
    }
    return { ok: exitCode === 0, stdout, stderr, exitCode }
  }
}

/** The caller's `compose.knownSensitiveValues` plus the server's blackboard token, when set. */
export function sensitiveValues(compose: Args | undefined, env: NodeJS.ProcessEnv): string[] {
  const given = compose?.knownSensitiveValues
  if (given !== undefined && (!Array.isArray(given) || given.some((v) => typeof v !== 'string')))
    throw new Error('compose.knownSensitiveValues must be an array of strings')
  // Redaction ignores values under four characters, so promising to redact one would be false.
  if ((given as string[] | undefined)?.some((value) => value.length < 4))
    throw new Error('compose.knownSensitiveValues entries must be at least 4 characters')
  // Facts commands inherit the GitHub tokens, so their output is redacted of those values too.
  const credentials = [env.AGENT_BLACKBOARD_TOKEN, env.GH_TOKEN, env.GITHUB_TOKEN].filter(
    (value): value is string => Boolean(value),
  )
  // Longest first, so a shorter value that is a prefix of a credential cannot break its match.
  return [...new Set([...((given as string[] | undefined) ?? []), ...credentials])].sort(
    (a, b) => b.length - a.length,
  )
}

/**
 * The transcript collector input: the server's worktree and default session roots only. A caller
 * may name the session (it must be this one), give the harness's own UUID session id when the
 * blackboard session id is not one, or report the transcript as unassessed.
 */
function transcriptInput(transcript: Args, base: ComposeBase): Args {
  if ('status' in transcript) {
    if ('sessionId' in transcript || 'harnessSessionId' in transcript)
      throw new Error(
        'compose.transcript: sessionId and harnessSessionId are exclusive with status',
      )
    return transcript
  }
  // A reason without a status is malformed, not a request to read the transcript.
  if ('reason' in transcript) throw new Error('compose.transcript.reason requires a status')
  if (transcript.sessionId !== undefined && transcript.sessionId !== base.sessionId)
    throw new Error('compose.transcript.sessionId must equal the sessionId of the call')
  const harnessId = transcript.harnessSessionId ?? base.sessionId
  // Transcripts are found by the harness's UUID; never let a lookup fail into "unavailable".
  if (typeof harnessId !== 'string' || !SESSION_ID.test(harnessId))
    throw new Error(
      'compose.transcript needs a UUID session id: pass harnessSessionId (the harness session ' +
        'UUID) or { status, reason }',
    )
  return { sessionId: harnessId, cwd: base.worktree }
}

/** Facts are either `{ status, reason }` (unassessed) or a live collection selector, never both. */
function factsInput(facts: Args, base: ComposeBase): Args {
  const selectors = ['pr', 'branch', 'noPr'].filter((key) => key in facts)
  if ('status' in facts) {
    if (selectors.length)
      throw new Error(`compose.facts: status is exclusive with ${selectors.join(', ')}`)
    return facts
  }
  if ('reason' in facts) throw new Error('compose.facts.reason requires a status')
  // The collector trusts these types; a string "false" must not read as noPr: true.
  for (const key of ['pr', 'branch'])
    if (key in facts && typeof facts[key] !== 'string')
      throw new Error(`compose.facts.${key} must be a string`)
  if ('noPr' in facts && typeof facts.noPr !== 'boolean')
    throw new Error('compose.facts.noPr must be a boolean')
  return { ...facts, execute: worktreeExecutor(base.worktree, base.env) }
}

/** Builds the retrospective markdown with `composeRetrospective`, rejecting unknown input keys. */
export async function composeFromArgs(compose: Args, base: ComposeBase): Promise<string> {
  rejectUnknown(compose, COMPOSE_KEYS)
  const missing = COMPOSE_REQUIRED.filter((key) => compose[key] === undefined)
  if (missing.length) throw new Error(`compose is missing: ${missing.join(', ')}`)
  if (typeof compose.narrative !== 'string' || !compose.narrative.trim())
    throw new Error('compose.narrative must be a non-empty string')
  const facts = section(compose, 'facts', FACTS_KEYS)
  const transcript = section(compose, 'transcript', TRANSCRIPT_KEYS)
  const input = {
    ...compose,
    sessionId: base.sessionId,
    repositories: base.repositories,
    workOutcome: base.workOutcome,
    feedbackCoverage: base.feedbackCoverage,
    facts: factsInput(facts, base),
    transcript: transcriptInput(transcript, base),
    knownSensitiveValues: sensitiveValues(compose, base.env),
    journal: { journalLoader: serverJournalLoader(base.env, base.dependencies) },
  }
  return composeRetrospective(input as unknown as RetrospectiveCompositionInput)
}
