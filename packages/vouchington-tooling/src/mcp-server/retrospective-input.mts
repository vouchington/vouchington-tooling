import { execFile } from 'node:child_process'
import {
  composeRetrospective,
  type FeedbackCoverage,
  type RetrospectiveCompositionInput,
  type WorkOutcome,
} from '../agent-blackboard/index.mts'
import type { BlackboardClientDependencies } from '../agent-blackboard/client.mts'
import { rejectUnknown, type Args } from './args.mts'
import { serverJournalLoader } from './journal-read.mts'

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
const FACTS_KEYS = ['pr', 'branch', 'noPr', 'repo', 'status', 'reason']
/** No path overrides: the server reads the session's transcript from its own default roots. */
const TRANSCRIPT_KEYS = ['sessionId', 'status', 'reason']
/** The longest a facts subprocess may run before it is killed. */
export const FACTS_TIMEOUT_MS = 120_000

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
  return (command: string, args: string[]) =>
    new Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }>(
      (resolve) =>
        execFile(
          command,
          args,
          {
            cwd: worktree,
            env: safe,
            maxBuffer: 10_000_000,
            timeout: timeoutMs,
            killSignal: 'SIGKILL',
          },
          (error, stdout, stderr) =>
            resolve({
              ok: error === null,
              stdout,
              stderr:
                error === null
                  ? stderr
                  : error.killed === true
                    ? `${stderr}${command} timed out after ${timeoutMs} ms`
                    : stderr || error.message,
              exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
            }),
        ),
    )
}

/** The caller's `compose.knownSensitiveValues` plus the server's blackboard token, when set. */
export function sensitiveValues(compose: Args | undefined, env: NodeJS.ProcessEnv): string[] {
  const given = compose?.knownSensitiveValues
  if (given !== undefined && (!Array.isArray(given) || given.some((v) => typeof v !== 'string')))
    throw new Error('compose.knownSensitiveValues must be an array of strings')
  const token = env.AGENT_BLACKBOARD_TOKEN
  return [...((given as string[] | undefined) ?? []), ...(token ? [token] : [])]
}

/**
 * The transcript collector input: the server's worktree and default session roots only. A caller
 * may name the session (it must be this one) or report the transcript as unassessed.
 */
function transcriptInput(transcript: Args, base: ComposeBase): Args {
  if ('status' in transcript) {
    if ('sessionId' in transcript)
      throw new Error('compose.transcript: sessionId and status are exclusive')
    return transcript
  }
  if (transcript.sessionId !== undefined && transcript.sessionId !== base.sessionId)
    throw new Error('compose.transcript.sessionId must equal the sessionId of the call')
  return { sessionId: base.sessionId, cwd: base.worktree }
}

/** Builds the retrospective markdown with `composeRetrospective`, rejecting unknown input keys. */
export async function composeFromArgs(compose: Args, base: ComposeBase): Promise<string> {
  rejectUnknown(compose, COMPOSE_KEYS)
  const missing = COMPOSE_REQUIRED.filter((key) => compose[key] === undefined)
  if (missing.length) throw new Error(`compose is missing: ${missing.join(', ')}`)
  const facts = section(compose, 'facts', FACTS_KEYS)
  const transcript = section(compose, 'transcript', TRANSCRIPT_KEYS)
  const input = {
    ...compose,
    sessionId: base.sessionId,
    repositories: base.repositories,
    workOutcome: base.workOutcome,
    feedbackCoverage: base.feedbackCoverage,
    facts:
      'status' in facts ? facts : { ...facts, execute: worktreeExecutor(base.worktree, base.env) },
    transcript: transcriptInput(transcript, base),
    knownSensitiveValues: sensitiveValues(compose, base.env),
    journal: { journalLoader: serverJournalLoader(base.env, base.dependencies) },
  }
  return composeRetrospective(input as unknown as RetrospectiveCompositionInput)
}
