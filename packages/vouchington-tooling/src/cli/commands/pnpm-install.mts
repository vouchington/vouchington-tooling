import { appendFile } from 'node:fs/promises'
import { parseInstallOptions, runInstallLifecycle } from '../../pnpm-install/index.mts'

export async function runPnpmInstallCli(args: readonly string[]): Promise<number> {
  const started = performance.now()
  let mode = 'unknown'
  let outcome = 'failed'
  try {
    mode = await runInstallLifecycle(parseInstallOptions([...args]))
    outcome = 'completed'
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  } finally {
    const summary = process.env.GITHUB_STEP_SUMMARY
    if (summary) {
      try {
        await appendFile(
          summary,
          `pnpm install: ${mode} ${outcome} in ${Math.round(performance.now() - started)}ms\n`,
        )
      } catch (error) {
        console.warn(
          `unable to append pnpm install summary: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
}
