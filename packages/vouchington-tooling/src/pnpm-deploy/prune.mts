import fs from 'node:fs'
import path from 'node:path'

export interface PruneResult {
  bytesRemoved: number
  filesRemoved: number
}

const DECLARATION_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts', '.d.ts.map', '.d.mts.map', '.d.cts.map']

function shouldPruneRuntimeDependencyFile(filePath: string): boolean {
  return (
    DECLARATION_SUFFIXES.some((suffix) => filePath.endsWith(suffix)) ||
    filePath.endsWith('.tsbuildinfo')
  )
}

function pruneDirectory(dir: string): PruneResult {
  const result: PruneResult = { bytesRemoved: 0, filesRemoved: 0 }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const child = pruneDirectory(entryPath)
      result.bytesRemoved += child.bytesRemoved
      result.filesRemoved += child.filesRemoved
      continue
    }
    if (!entry.isFile() || !shouldPruneRuntimeDependencyFile(entryPath)) continue

    const { size } = fs.statSync(entryPath)
    fs.rmSync(entryPath, { force: true })
    result.bytesRemoved += size
    result.filesRemoved += 1
  }

  return result
}

export function pruneDeployedRuntimeDeps(prodDir: string): PruneResult {
  const pnpmStore = path.join(prodDir, 'node_modules', '.pnpm')
  if (!fs.existsSync(pnpmStore)) return { bytesRemoved: 0, filesRemoved: 0 }

  return pruneDirectory(pnpmStore)
}

function resolveCliProdDirs(args: readonly string[], env: NodeJS.ProcessEnv): string[] {
  if (args.length > 0) return [...args]
  const prodDir = env.PROD_DIR
  if (!prodDir) throw new Error('PROD_DIR or a directory argument is required')
  return [prodDir]
}

interface PruneCliOptions {
  args: readonly string[]
  env: NodeJS.ProcessEnv
  isMain: boolean
  prune?: typeof pruneDeployedRuntimeDeps
  stdout: (message: string) => void
}

export function runPruneDeployedRuntimeDepsCli({
  args,
  env,
  isMain,
  prune = pruneDeployedRuntimeDeps,
  stdout,
}: PruneCliOptions): void {
  if (!isMain) return

  for (const prodDir of resolveCliProdDirs(args, env)) {
    const result = prune(prodDir)
    stdout(
      `Pruned ${result.filesRemoved} runtime dependency artifact(s) from ${prodDir} (${result.bytesRemoved} bytes)`,
    )
  }
}
