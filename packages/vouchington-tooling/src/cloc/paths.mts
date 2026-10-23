import type { ClocConfig } from './config.mts'

/** Decides which tracked paths are counted and which scc targets to hand the binary. */
export function createPathPolicy(config: ClocConfig) {
  const { countedRoots, countedRootFiles, ignoredDirs } = config
  const countAll = countedRoots.length === 0 && countedRootFiles.length === 0
  const ignored = new Set(ignoredDirs)

  function isCountedPath(filePath: string): boolean {
    return (
      countAll ||
      countedRootFiles.includes(filePath) ||
      countedRoots.some((root) => filePath === root || filePath.startsWith(`${root}/`))
    )
  }

  function isIgnoredPath(filePath: string): boolean {
    return filePath
      .split('/')
      .slice(0, -1)
      .some((segment) => ignored.has(segment))
  }

  function shouldCountFile(filePath: string, trackedFiles: ReadonlySet<string>): boolean {
    return trackedFiles.has(filePath) && isCountedPath(filePath) && !isIgnoredPath(filePath)
  }

  function countTargetsFor(trackedFiles: ReadonlySet<string>): string[] {
    if (countAll) return ['.']
    const files = [...trackedFiles]
    return [...countedRoots, ...countedRootFiles].filter(
      (target) => trackedFiles.has(target) || files.some((file) => file.startsWith(`${target}/`)),
    )
  }

  return { isCountedPath, shouldCountFile, countTargetsFor }
}
