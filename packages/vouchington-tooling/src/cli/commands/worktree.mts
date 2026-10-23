import {
  formatReport,
  reclaimWorktrees,
  type ReclaimOptions,
} from '../../git-worktrees/reclaim.mts'
import { commandUsage } from '../usage.mts'

function parseFlags(flags: readonly string[]): ReclaimOptions & { yes: boolean; json: boolean } {
  const options: {
    prLimit?: number
    maxWorktrees?: number
    timeoutMs?: number
    after?: string
    yes: boolean
    json: boolean
  } = { yes: false, json: false }
  const seen = new Set<string>()
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i]!
    if (seen.has(flag)) throw new Error('duplicate flag')
    seen.add(flag)
    if (flag === '--yes') {
      options.yes = true
      continue
    }
    if (flag === '--json') {
      options.json = true
      continue
    }
    const value = flags[++i]
    if (value === undefined || value.startsWith('--')) throw new Error('missing flag value')
    if (flag === '--after') options.after = value
    else if (flag === '--max-worktrees' || flag === '--timeout-ms' || flag === '--pr-limit') {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new Error('scan limits must be positive integers')
      if (flag === '--max-worktrees') options.maxWorktrees = Number(value)
      else if (flag === '--timeout-ms') options.timeoutMs = Number(value)
      else {
        if (Number(value) > 10_000) throw new Error('PR limit exceeds 10000')
        options.prLimit = Number(value)
      }
    } else throw new Error('unknown flag')
  }
  return options
}

/** Reclamation is a dry run unless --yes; scan limits return an explicit resume cursor. */
export function runWorktreeCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): number {
  const [subcommand, ...flags] = args
  let options: ReturnType<typeof parseFlags>
  try {
    if (subcommand !== 'reclaim') throw new Error('unknown subcommand')
    options = parseFlags(flags)
  } catch {
    process.stderr.write(
      `vouchington: expected: reclaim [--yes] [--json] [--max-worktrees N] [--timeout-ms N] [--pr-limit N] [--after PATH]\n${commandUsage('worktree')}`,
    )
    return 2
  }
  try {
    const start = Date.now()
    process.stderr.write('worktree reclaim: scanning local worktrees and shared PR lists\n')
    const report = reclaimWorktrees(options.yes, { cwd, env }, options)
    const json = options.json
    process.stdout.write(json ? `${JSON.stringify(report)}\n` : formatReport(report))
    process.stderr.write(
      `worktree reclaim: ${report.hasMore ? 'scan incomplete' : 'complete'} in ${((Date.now() - start) / 1000).toFixed(1)}s\n`,
    )
    return 0
  } catch (error) {
    process.stderr.write(`vouchington: ${(error as Error).message}\n`)
    return 1
  }
}
