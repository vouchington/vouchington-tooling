import { runNugetCentralVersionCli } from '../../nuget-central-version/cli.mts'

export function runNugetCentralVersionCommand(args: readonly string[]): number {
  try {
    runNugetCentralVersionCli(args)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
