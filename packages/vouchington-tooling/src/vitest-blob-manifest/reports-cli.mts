import { VITEST_SUITE_PATTERN } from './constants.mts'
import { prepareVitestReports } from './reports.mts'
import { parseGitHubRunAttempt } from './run-attempt.mts'

interface ExpectationContext {
  readonly version: 'vitest-report-expectations:v2'
  readonly attempt: number
  readonly suites: readonly { readonly suite: string; readonly minimumAttempt: number }[]
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function parseContext(raw: string, attempt: number): ExpectationContext {
  const parsed = JSON.parse(raw) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('Vitest report expectation context must be an object')
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- establish a record view after validating the untrusted JSON object
  const context = parsed as Record<string, unknown>
  if (
    Object.keys(context).toSorted().join('\0') !== ['attempt', 'suites', 'version'].join('\0') ||
    context.version !== 'vitest-report-expectations:v2' ||
    context.attempt !== attempt ||
    !Array.isArray(context.suites) ||
    context.suites.some(
      (expectation) =>
        typeof expectation !== 'object' ||
        expectation === null ||
        Array.isArray(expectation) ||
        Object.keys(expectation).toSorted().join('\0') !== ['minimumAttempt', 'suite'].join('\0') ||
        typeof (expectation as Record<string, unknown>).suite !== 'string' ||
        !VITEST_SUITE_PATTERN.test((expectation as Record<string, unknown>).suite as string) ||
        !Number.isSafeInteger((expectation as Record<string, unknown>).minimumAttempt) ||
        Number((expectation as Record<string, unknown>).minimumAttempt) < 1 ||
        Number((expectation as Record<string, unknown>).minimumAttempt) > attempt,
    )
  )
    throw new Error('Vitest report expectation context has an invalid schema')
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- retain the validated expectation type after the complete schema check
  const typed = context as unknown as ExpectationContext
  const suites = typed.suites.map((expectation) => expectation.suite)
  if (new Set(suites).size !== suites.length || suites.join('\0') !== suites.toSorted().join('\0'))
    throw new Error('Vitest report expectation suites must be unique and sorted')
  return typed
}

/** Validates GitHub run context, then prepares the selected report JSON files. */
export function runPrepareVitestReportsCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): void {
  const [
    primaryDir = './vitest-blob-primary',
    fallbackDir = './vitest-blob-fallback',
    outputDir = './vitest-blob-reports/merge-input',
    ...extra
  ] = args
  if (extra.length > 0) throw new Error('Expected at most three Vitest report directories')
  const currentAttempt = parseGitHubRunAttempt(env.GITHUB_RUN_ATTEMPT)
  const result = prepareVitestReports({
    primaryDir,
    fallbackDir,
    outputDir,
    expectedSuites: parseContext(required(env, 'VITEST_REPORT_EXPECTATIONS'), currentAttempt)
      .suites,
    repository: required(env, 'GITHUB_REPOSITORY'),
    revision: required(env, 'GITHUB_SHA'),
    run: { id: required(env, 'GITHUB_RUN_ID'), currentAttempt },
  })
  for (const rejected of result.rejectedSources)
    log(`::warning::Rejected Vitest ${rejected.source} report source: ${rejected.reason}`)
  for (const selected of result.selected)
    log(
      `Selected Vitest report ${selected.suite} from attempt ${selected.attempt} (${selected.sources.join('+')})`,
    )
}
