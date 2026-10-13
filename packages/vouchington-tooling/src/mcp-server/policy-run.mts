import { fileURLToPath } from 'node:url'
import { resolvePolicyModule } from './policy-config.mts'
import {
  policyEnvironment,
  spawnPolicy,
  type PolicyOutcome,
  type PolicySpawner,
} from './policy-spawn.mts'

/** How long each policy export may run before its process is killed, in milliseconds. */
export const POLICY_TIMEOUTS_MS = {
  validateRetrospective: 30_000,
  validatePullRequest: 120_000,
  pullRequestDefaults: 120_000,
} as const

export type PolicyExport = keyof typeof POLICY_TIMEOUTS_MS

export const POLICY_MAX_OUTPUT_BYTES = 1_000_000
const STDERR_EXCERPT_BYTES = 2_000

const RUNNER = fileURLToPath(new URL('../../bin/policy-runner.mjs', import.meta.url))

export type PolicyResult =
  | { status: 'no-policy' }
  | { status: 'skipped' }
  | { status: 'ok'; result: unknown }

export type PolicyRun = {
  worktree: string
  export: PolicyExport
  input: unknown
  env: NodeJS.ProcessEnv
  /** Test seam: replaces the real child process. */
  spawn?: PolicySpawner
}

function failure(name: PolicyExport, reason: string, outcome?: PolicyOutcome): Error {
  const stderr = outcome?.stderr.trim().slice(-STDERR_EXCERPT_BYTES)
  return new Error(`policy ${name} ${reason}${stderr ? `: ${stderr}` : ''}`)
}

function parseReply(name: PolicyExport, outcome: PolicyOutcome): PolicyResult {
  let reply: { ok?: unknown; skipped?: unknown; result?: unknown; error?: unknown } | null
  try {
    reply = JSON.parse(outcome.stdout)
  } catch {
    throw failure(name, 'produced output that is not valid JSON', outcome)
  }
  if (reply?.ok === false) throw failure(name, `failed: ${String(reply.error)}`)
  if (reply?.ok !== true) throw failure(name, 'produced an unrecognized reply')
  return reply.skipped === true ? { status: 'skipped' } : { status: 'ok', result: reply.result }
}

/**
 * Runs one export of the worktree's declared policy module in a fresh child process (never in
 * this one). Resolves `no-policy` when the worktree declares none and `skipped` when the module
 * lacks the export. A timeout, crash, non-zero exit, oversized output, or unusable reply throws:
 * a failed policy is never a pass.
 */
export async function runPolicyExport(run: PolicyRun): Promise<PolicyResult> {
  const { export: name } = run
  const module = await resolvePolicyModule(run.worktree)
  if (module === undefined) return { status: 'no-policy' }
  const timeoutMs = POLICY_TIMEOUTS_MS[name]
  const outcome = await (run.spawn ?? spawnPolicy)({
    command: process.execPath,
    args: [RUNNER, module],
    cwd: run.worktree,
    env: policyEnvironment(run.env),
    input: JSON.stringify({ policyVersion: 1, export: name, input: run.input }),
    timeoutMs,
    maxOutputBytes: POLICY_MAX_OUTPUT_BYTES,
  })
  if (outcome.timedOut) throw failure(name, `timed out after ${timeoutMs / 1000}s`)
  if (outcome.overflowed)
    throw failure(name, `wrote more than ${POLICY_MAX_OUTPUT_BYTES} bytes of output`)
  if (outcome.exitCode !== 0) throw failure(name, `exited with code ${outcome.exitCode}`, outcome)
  return parseReply(name, outcome)
}

export type ValidatorReport = { errors: string[]; warnings: string[] }

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** Runs a validator export and checks its result is `{ errors: string[], warnings?: string[] }`. */
export async function runValidator(
  run: PolicyRun,
): Promise<ValidatorReport | { status: 'no-policy' | 'skipped' }> {
  const outcome = await runPolicyExport(run)
  if (outcome.status !== 'ok') return outcome
  const result = outcome.result as { errors?: unknown; warnings?: unknown } | null
  if (
    !isStringArray(result?.errors) ||
    (result.warnings !== undefined && !isStringArray(result.warnings))
  )
    throw new Error(`policy ${run.export} must return { errors: string[], warnings?: string[] }`)
  return { errors: result.errors, warnings: result.warnings ?? [] }
}
