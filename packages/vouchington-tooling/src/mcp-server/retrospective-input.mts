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
const TRANSCRIPT_KEYS = [
  'sessionId',
  'jsonlPath',
  'projectsDir',
  'codexSessionsDir',
  'grokSessionsDir',
  'status',
  'reason',
]

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

/** Facts commands run in the worktree and never see the blackboard credentials. */
function worktreeExecutor(worktree: string, env: NodeJS.ProcessEnv) {
  const { AGENT_BLACKBOARD_URL: _url, AGENT_BLACKBOARD_TOKEN: _token, ...safe } = env
  return (command: string, args: string[]) =>
    new Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }>(
      (resolve) =>
        execFile(
          command,
          args,
          { cwd: worktree, env: safe, maxBuffer: 10_000_000 },
          (error, stdout, stderr) =>
            resolve({
              ok: error === null,
              stdout,
              stderr: error === null ? stderr : stderr || error.message,
              exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
            }),
        ),
    )
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
    transcript: 'status' in transcript ? transcript : { cwd: base.worktree, ...transcript },
    journal: { journalLoader: serverJournalLoader(base.env, base.dependencies) },
  }
  return composeRetrospective(input as unknown as RetrospectiveCompositionInput)
}
