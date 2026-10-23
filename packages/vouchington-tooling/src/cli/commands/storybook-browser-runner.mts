import { parseStorybookBrowserRunnerArgs } from '../../storybook-browser-runner/args.mts'
import { runStorybookBrowserTests } from '../../storybook-browser-runner/index.mts'
import { commandUsage } from '../usage.mts'

/**
 * `vouchington storybook-browser-runner --project <name> [flags] [-- <argv>...]`: runs the
 * Storybook Vitest browser project under the cache, retry and watchdog runner. Exits with the test
 * command's resolved code, or 2 on a usage error.
 */
export async function runStorybookBrowserRunnerCommand(
  args: readonly string[],
  run: typeof runStorybookBrowserTests = runStorybookBrowserTests,
  platform: NodeJS.Platform = process.platform,
): Promise<number> {
  if (platform === 'win32') {
    process.stderr.write('vouchington: storybook-browser-runner is POSIX-only (process groups)\n')
    return 1
  }
  let project: ReturnType<typeof parseStorybookBrowserRunnerArgs>
  try {
    project = parseStorybookBrowserRunnerArgs(args)
  } catch (error) {
    process.stderr.write(
      `vouchington: ${(error as Error).message}\n${commandUsage('storybook-browser-runner')}`,
    )
    return 2
  }
  try {
    return await run(project)
  } catch (error) {
    process.stderr.write(`vouchington: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
