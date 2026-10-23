import { trackedPaths } from '../dead-code/tracked-snapshot.mts'
import type { ClocConfig } from './config.mts'
import { createPathPolicy } from './paths.mts'
import { normalizePath } from './patterns.mts'
import type { CountedFile } from './rows.mts'
import { readSccFiles } from './scc.mts'

export type CountOptions = { cwd: string; sccBin?: string; env?: NodeJS.ProcessEnv }

/** Lists tracked files with git, then counts the configured targets with scc. */
export async function countFiles(
  config: ClocConfig,
  options: CountOptions,
): Promise<CountedFile[]> {
  const tracked = new Set(trackedPaths(options.cwd).map(normalizePath))
  const policy = createPathPolicy(config)
  const sccBin = options.sccBin ?? options.env?.SCC_BIN ?? config.sccBin ?? 'scc'
  try {
    return await readSccFiles({
      sccBin,
      targets: policy.countTargetsFor(tracked),
      excludedDirs: config.excludedDirs,
      cwd: options.cwd,
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
