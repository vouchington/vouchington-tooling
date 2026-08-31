import { runVitestReportAttemptCli } from '../../vitest-blob-manifest/report-attempt-cli.mts'

export function runVitestReportAttemptCommand(
  args: readonly string[],
  run = runVitestReportAttemptCli,
): number {
  try {
    run(args)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
