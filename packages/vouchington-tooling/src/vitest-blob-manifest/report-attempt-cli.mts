import {
  readVitestReportAttempts,
  writeVitestReportAttempt,
  type VitestReportAttemptIdentity,
} from './report-attempt.mts'

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function identity(env: NodeJS.ProcessEnv): VitestReportAttemptIdentity {
  return {
    repository: required(env, 'GITHUB_REPOSITORY'),
    revision: required(env, 'GITHUB_SHA'),
    runId: required(env, 'GITHUB_RUN_ID'),
    attempt: Number(required(env, 'GITHUB_RUN_ATTEMPT')),
  }
}

/** Writes or reads authenticated-for-run Vitest report-attempt markers. */
export function runVitestReportAttemptCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): void {
  const [command, path, suite, ...extra] = args
  if (extra.length > 0 || !path || (command !== 'write' && command !== 'read'))
    throw new Error('Usage: vouchington vitest-report-attempt <write DIRECTORY SUITE|read ROOT>')
  const current = identity(env)
  if (command === 'write') {
    if (!suite)
      throw new Error('Usage: vouchington vitest-report-attempt <write DIRECTORY SUITE|read ROOT>')
    writeVitestReportAttempt(path, suite, current)
    return
  }
  if (suite)
    throw new Error('Usage: vouchington vitest-report-attempt <write DIRECTORY SUITE|read ROOT>')
  log(JSON.stringify(readVitestReportAttempts(path, current)))
}
