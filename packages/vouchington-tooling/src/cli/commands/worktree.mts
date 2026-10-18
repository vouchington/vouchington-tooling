import { formatReport, reclaimWorktrees } from '../../git-worktrees/reclaim.mts'
import { commandUsage } from '../usage.mts'

/** `vouchington worktree reclaim [--yes] [--json]`: exits 2 on bad usage, 1 when git cannot list. */
export function runWorktreeCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): number {
  const [subcommand, ...flags] = args
  const unknown = flags.find((flag) => flag !== '--yes' && flag !== '--json')
  if (subcommand !== 'reclaim' || unknown !== undefined) {
    process.stderr.write(
      `vouchington: expected: reclaim [--yes] [--json]\n${commandUsage('worktree')}`,
    )
    return 2
  }
  try {
    const report = reclaimWorktrees(flags.includes('--yes'), { cwd, env })
    const json = flags.includes('--json')
    process.stdout.write(json ? `${JSON.stringify(report)}\n` : formatReport(report))
    return 0
  } catch (error) {
    process.stderr.write(`vouchington: ${(error as Error).message}\n`)
    return 1
  }
}
