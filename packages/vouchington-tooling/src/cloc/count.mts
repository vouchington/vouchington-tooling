import { resolve } from 'node:path'
import type { ClocConfig } from './config.mts'
import { createPathPolicy } from './paths.mts'
import type { CountedFile } from './rows.mts'
import { readSccFiles } from './scc.mts'
import { gitTopLevel, listTrackedFiles } from './tracked.mts'

export type CountOptions = { cwd: string; sccBin?: string; env?: NodeJS.ProcessEnv }

/** Lists tracked files with git, then counts the configured targets with scc. */
export async function countFiles(
  config: ClocConfig,
  options: CountOptions,
): Promise<CountedFile[]> {
  const root = await gitTopLevel(options.cwd)
  const tracked = await listTrackedFiles(root)
  const policy = createPathPolicy(config)
  const targets = policy.countTargetsFor(tracked)
  // scc with no target would scan the whole working directory.
  if (targets.length === 0) return []
  const requested = options.sccBin ?? (options.env ?? process.env).SCC_BIN ?? config.sccBin ?? 'scc'
  // The child runs from the repository top level; a path-like binary is relative to the caller.
  const sccBin = requested.includes('/') ? resolve(options.cwd, requested) : requested
  try {
    return await readSccFiles({
      sccBin,
      targets,
      excludedDirs: config.excludedDirs,
      cwd: root,
      keep: (filePath) => policy.shouldCountFile(filePath, tracked),
    })
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      const hint = config.missingSccHint === undefined ? '' : ` ${config.missingSccHint}`
      throw new Error(`scc is required but "${sccBin}" was not found.${hint}`, { cause: err })
    }
    throw err
  }
}
