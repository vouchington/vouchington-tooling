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

type PolicyExport = keyof typeof POLICY_TIMEOUTS_MS

const POLICY_MAX_OUTPUT_BYTES = 1_000_000
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
  const secrets = credentialValues(run.env)
  // A policy can echo a credential it was given (GH_TOKEN) in a stack, stderr, or result; the
  // caller of an MCP tool must never receive one. Diagnostics may carry it JSON-escaped too.
  const escaped = secrets.map((secret) => JSON.stringify(secret).slice(1, -1))
  const forms = [...new Set([...escaped, ...secrets])].sort((a, b) => b.length - a.length)
  const spawn = run.spawn ?? spawnPolicy
  // stderr is scrubbed whole, before its excerpt could cut a credential into an unmatched suffix.
  const scrubbing: PolicySpawner = async (request) => {
    const outcome = await spawn(request)
    return { ...outcome, stderr: scrubText(outcome.stderr, forms) }
  }
  try {
    const result = await runUnscrubbed(run, scrubbing)
    return result.status === 'ok'
      ? { status: 'ok', result: scrubValue(result.result, secrets) }
      : result
  } catch (error) {
    throw new Error(scrubText((error as Error).message, forms), { cause: error })
  }
}

const CREDENTIAL_NAMES = ['AGENT_BLACKBOARD_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] as const

/**
 * Credential values held by the server, longest first. A value too short to redact without
 * mangling every output fails closed: the policy never runs rather than risk echoing it.
 */
function credentialValues(env: NodeJS.ProcessEnv): string[] {
  const values = CREDENTIAL_NAMES.map((name) => env[name]).filter((value): value is string =>
    Boolean(value),
  )
  if (values.some((value) => value.length < 4))
    throw new Error(
      `a credential (${CREDENTIAL_NAMES.join(', ')}) is too short to redact: policy tools refuse to run`,
    )
  return [...new Set(values)].sort((a, b) => b.length - a.length)
}

function scrubText(text: string, secrets: string[]): string {
  return secrets.reduce((scrubbed, secret) => scrubbed.replaceAll(secret, '[REDACTED]'), text)
}

function scrubValue(value: unknown, secrets: string[]): unknown {
  if (secrets.length === 0 || value === undefined) return value
  // Each secret is matched in its JSON-escaped form so the round trip stays valid JSON.
  const escaped = secrets.map((secret) => JSON.stringify(secret).slice(1, -1))
  return JSON.parse(scrubText(JSON.stringify(value), escaped))
}

async function runUnscrubbed(run: PolicyRun, spawn: PolicySpawner): Promise<PolicyResult> {
  const { export: name } = run
  const module = await resolvePolicyModule(run.worktree)
  if (module === undefined) return { status: 'no-policy' }
  const timeoutMs = POLICY_TIMEOUTS_MS[name]
  const outcome = await spawn({
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
