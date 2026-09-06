import fs from 'node:fs'
import path from 'node:path'

export const EPOCH_PRUNED_AT = 'Thu, 01 Jan 1970 00:00:00 GMT'

export interface NormalizeDeployedLayerResult {
  prunedAtPinned: boolean
  entriesTouched: number
}

export function normalizeDeployedLayer(prodDir: string): NormalizeDeployedLayerResult {
  return {
    prunedAtPinned: pinPrunedAt(prodDir),
    entriesTouched: clampTreeMtimes(prodDir),
  }
}

function pinPrunedAt(prodDir: string): boolean {
  const modulesPath = path.join(prodDir, 'node_modules', '.modules.yaml')
  if (!fs.existsSync(modulesPath)) {
    throw new Error(`${modulesPath} is missing; expected pnpm deploy to write it`)
  }

  // pnpm 11.13.1 writeModulesManifest serializes this file with JSON.stringify
  // despite the .yaml name. A pnpm bump that switches to YAML must update this parse.
  const parsed: unknown = JSON.parse(fs.readFileSync(modulesPath, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${modulesPath} is not a JSON object`)
  }

  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- establish the mutable manifest shape after validating the parsed object
  const manifest = parsed as { prunedAt?: string }
  manifest.prunedAt = EPOCH_PRUNED_AT
  fs.writeFileSync(modulesPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return true
}

function clampTreeMtimes(root: string): number {
  let entriesTouched = 0
  function visit(entryPath: string, isDirectory: boolean): void {
    if (isDirectory) {
      for (const entry of fs.readdirSync(entryPath, { withFileTypes: true })) {
        visit(path.join(entryPath, entry.name), entry.isDirectory())
      }
    } else {
      const stats = fs.lstatSync(entryPath)
      if (stats.isFile() && stats.nlink > 1) {
        const copyPath = `${entryPath}.${process.pid}.copy`
        fs.copyFileSync(entryPath, copyPath)
        fs.renameSync(copyPath, entryPath)
      }
    }
    fs.lutimesSync(entryPath, 0, 0)
    entriesTouched += 1
  }

  visit(root, fs.lstatSync(root).isDirectory())
  return entriesTouched
}

function resolveCliProdDirs(args: readonly string[], env: NodeJS.ProcessEnv): string[] {
  if (args.length > 0) return [...args]
  const prodDir = env.PROD_DIR
  if (!prodDir) throw new Error('PROD_DIR or a directory argument is required')
  return [prodDir]
}

interface NormalizeCliOptions {
  args: readonly string[]
  env: NodeJS.ProcessEnv
  isMain: boolean
  normalize?: typeof normalizeDeployedLayer
  stdout: (message: string) => void
}

export function runNormalizeDeployedLayerCli({
  args,
  env,
  isMain,
  normalize = normalizeDeployedLayer,
  stdout,
}: NormalizeCliOptions): void {
  if (!isMain) return

  for (const prodDir of resolveCliProdDirs(args, env)) {
    const result = normalize(prodDir)
    const prunedAt = result.prunedAtPinned ? 'prunedAt pinned' : 'prunedAt absent'
    stdout(
      `Normalized deployed layer at ${prodDir} (${prunedAt}, ${result.entriesTouched} entries)`,
    )
  }
}
