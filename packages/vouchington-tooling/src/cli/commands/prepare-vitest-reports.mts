import { runPrepareVitestReportsCli } from '../../vitest-blob-manifest/reports-cli.mts'

export function runPrepareVitestReportsCommand(
  args: readonly string[],
  run = runPrepareVitestReportsCli,
): number {
  try {
    run(args)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
