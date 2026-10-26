import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse as parseYaml } from 'yaml'

export interface RegistryFiles {
  /** `source` globs of the syncpack config. */
  syncpackSource: string[]
  /** `packages` globs of the pnpm workspace file. */
  workspacePackages: string[]
  /** Every group of the path-filter file, runtime groups included. */
  pathFilters: Record<string, string[]>
}

export interface RegistryFilePaths {
  syncpackConfig: string
  workspaceFile: string
  pathFilters: string
}

/** Reads the three registry files, each relative to `root`. */
export function loadRegistryFiles(root: string, paths: RegistryFilePaths): RegistryFiles {
  const syncpack = JSON.parse(readFileSync(join(root, paths.syncpackConfig), 'utf8')) as {
    source?: string[]
  }
  const workspace = parseYaml(readFileSync(join(root, paths.workspaceFile), 'utf8')) as {
    packages?: string[]
  } | null
  const pathFilters = parseYaml(readFileSync(join(root, paths.pathFilters), 'utf8')) as Record<
    string,
    string[]
  > | null
  return {
    syncpackSource: syncpack.source ?? [],
    workspacePackages: workspace?.packages ?? [],
    pathFilters: pathFilters ?? {},
  }
}
