import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createGhExec, type GhExec } from '../gha-post-review/github.mts'
import {
  completeCheckRun,
  createCheckRun,
  CheckRunError,
  type CheckRunConclusion,
  type CheckRunStatus,
  type CreateCheckRunInput,
} from './github.mts'

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]
  if (!value) throw new CheckRunError(`${name} is required.`)
  return value
}

function parseStatus(value: string): CheckRunStatus {
  if (value !== 'in_progress' && value !== 'completed') {
    throw new CheckRunError(`STATUS must be "in_progress" or "completed" (got "${value}").`)
  }
  return value
}

function parseConclusion(value: string): CheckRunConclusion {
  if (value !== 'success' && value !== 'neutral') {
    throw new CheckRunError(`CONCLUSION must be "success" or "neutral" (got "${value}").`)
  }
  return value
}

function appendOutput(name: string, value: string, outputPath: string | undefined): void {
  if (!outputPath) return
  appendFileSync(outputPath, `${name}=${value}\n`)
}

/** Builds a create-check-run input from env, requiring CONCLUSION only when STATUS is completed. */
function readCreateInput(env: NodeJS.ProcessEnv): CreateCheckRunInput {
  const status = parseStatus(requireEnv('STATUS', env))
  const shared = {
    repository: requireEnv('GITHUB_REPOSITORY', env),
    name: requireEnv('CHECK_NAME', env),
    headSha: requireEnv('HEAD_SHA', env),
    title: requireEnv('TITLE', env),
    summary: requireEnv('SUMMARY', env),
  }
  if (status === 'completed') {
    return { ...shared, status, conclusion: parseConclusion(requireEnv('CONCLUSION', env)) }
  }
  return { ...shared, status }
}

function runCreate(env: NodeJS.ProcessEnv, exec: GhExec): void {
  const id = createCheckRun(readCreateInput(env), exec)
  appendOutput('check_run_id', id, env.GITHUB_OUTPUT)
}

/** No-ops when CHECK_RUN_ID is unset: the create step may have already finalized the check. */
function runComplete(env: NodeJS.ProcessEnv, exec: GhExec): void {
  const checkRunId = env.CHECK_RUN_ID ?? ''
  if (checkRunId === '') return
  completeCheckRun(
    {
      repository: requireEnv('GITHUB_REPOSITORY', env),
      checkRunId,
      conclusion: parseConclusion(requireEnv('CONCLUSION', env)),
      title: requireEnv('TITLE', env),
      summary: requireEnv('SUMMARY', env),
    },
    exec,
  )
}

export function runCheckRunCli(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
  exec: GhExec = createGhExec(),
): number {
  const subcommand = argv[2]
  try {
    if (subcommand === 'create') {
      runCreate(env, exec)
      return 0
    }
    if (subcommand === 'complete') {
      runComplete(env, exec)
      return 0
    }
    throw new CheckRunError(`Unknown subcommand "${String(subcommand)}". Use create or complete.`)
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

/* v8 ignore next 3 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runCheckRunCli()
}
