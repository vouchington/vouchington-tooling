import { parseAuditArgs } from '../../sandbox-command-audit/args.mts'
import { runAudit, type LoadRulesModule } from '../../sandbox-command-audit/run.mts'
import { commandUsage } from '../usage.mts'

/**
 * `vouchington sandbox-command-audit --rules <module> [flags]`: scans Claude and Codex transcripts
 * for sandbox escalations, denials and permission failures, scoped to the repository, and prints a
 * report. Exits 0 with a report, 2 on a usage error, 1 when the rules module cannot load.
 */
export async function runSandboxCommandAuditCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  load?: LoadRulesModule,
): Promise<number> {
  let parsed: ReturnType<typeof parseAuditArgs>
  try {
    parsed = parseAuditArgs(args, env)
  } catch (error) {
    const usage = commandUsage('sandbox-command-audit')
    process.stderr.write(`vouchington: ${(error as Error).message}\n${usage}`)
    return 2
  }
  try {
    process.stdout.write(await runAudit(parsed, { cwd: process.cwd(), ...(load ? { load } : {}) }))
    return 0
  } catch (error) {
    process.stderr.write(`vouchington: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
