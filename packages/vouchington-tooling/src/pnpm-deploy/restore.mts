import fs from 'node:fs'
import path from 'node:path'

export interface RestoreWorkspacePackagesOptions {
  backendDir?: string
  prodDir: string
  workspaceRoot?: string
}

function expandWorkspace(backendDir: string, pattern: string): string[] {
  if (!pattern.includes('*')) return [path.resolve(backendDir, pattern)]

  const base = path.resolve(backendDir, pattern.slice(0, pattern.indexOf('*')))
  if (!fs.existsSync(base)) return []

  return fs
    .readdirSync(base, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? [path.join(base, entry.name)] : []))
}

function packagePath(packageName: string): string {
  return path.join(...packageName.split('/'))
}

function linkTarget(fromDir: string, toPath: string): string {
  return path.relative(fromDir, toPath)
}

function readWorkspacePackageNames(backendDir: string): Set<string> {
  const backendPackage = JSON.parse(fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8'))
  const workspaces = Array.isArray(backendPackage.workspaces) ? backendPackage.workspaces : []
  const names = new Set<string>()

  for (const workspace of workspaces.flatMap((pattern: string) =>
    expandWorkspace(backendDir, pattern),
  )) {
    const packageJson = path.join(workspace, 'package.json')
    if (!fs.existsSync(packageJson)) continue

    const { name } = JSON.parse(fs.readFileSync(packageJson, 'utf8')) as { name?: string }
    if (name) names.add(name)
  }

  return names
}

/**
 * Node's --experimental-strip-types refuses to load TypeScript whose real path
 * contains a node_modules segment, but pnpm deploy places workspace packages
 * (shipped as TypeScript source) inside the virtual store at
 * node_modules/.pnpm/<store-dir>/node_modules/<name>.
 *
 * Relocate every workspace-package copy outside node_modules while preserving
 * pnpm's resolution topology, without enumerating dependencies:
 *
 * - move the content dir to workspace-packages/<store-dir>/<name>
 * - leave a relative symlink at the original virtual-store location, so every
 *   pnpm-created link (top-level node_modules entries, sibling links from other
 *   store dirs) keeps resolving through it
 * - add a node_modules backlink inside the moved dir pointing at the package's
 *   original virtual-store sibling directory, so the package's own imports
 *   resolve exactly as pnpm laid them out
 */
export function restoreDeployedWorkspacePackages({
  backendDir,
  prodDir,
  workspaceRoot,
}: RestoreWorkspacePackagesOptions): void {
  if (!prodDir) throw new Error('prodDir is required')
  if (!backendDir) throw new Error('backendDir is required')
  const resolvedWorkspaceRoot = workspaceRoot ?? path.join(prodDir, 'workspace-packages')
  const workspacePackageNames = readWorkspacePackageNames(backendDir)
  const pnpmRoot = path.join(prodDir, 'node_modules', '.pnpm')
  if (!fs.existsSync(pnpmRoot)) return

  for (const storeEntry of fs.readdirSync(pnpmRoot, { withFileTypes: true })) {
    if (!storeEntry.isDirectory() || storeEntry.name === 'node_modules') continue

    const storeModules = path.join(pnpmRoot, storeEntry.name, 'node_modules')
    for (const name of workspacePackageNames) {
      const contentDir = path.join(storeModules, packagePath(name))
      const stats = fs.lstatSync(contentDir, { throwIfNoEntry: false })
      if (!stats?.isDirectory()) continue

      const relocated = path.join(resolvedWorkspaceRoot, storeEntry.name, packagePath(name))
      fs.rmSync(relocated, { recursive: true, force: true })
      fs.mkdirSync(path.dirname(relocated), { recursive: true })
      // copy+delete, not rename: renaming a directory out of a lower Docker
      // overlayfs layer fails with EXDEV
      fs.cpSync(contentDir, relocated, { recursive: true, verbatimSymlinks: true })
      fs.rmSync(contentDir, { recursive: true, force: true })
      fs.symlinkSync(linkTarget(path.dirname(contentDir), relocated), contentDir, 'dir')

      const backlink = path.join(relocated, 'node_modules')
      const backlinkStats = fs.lstatSync(backlink, { throwIfNoEntry: false })
      if (!backlinkStats) {
        fs.symlinkSync(linkTarget(relocated, storeModules), backlink, 'dir')
      } else if (backlinkStats.isDirectory()) {
        // pnpm deploy leaves a real node_modules (containing .bin) inside some
        // injected packages; merge sibling links into it instead of replacing it
        for (const sibling of fs.readdirSync(storeModules)) {
          const siblingLink = path.join(backlink, sibling)
          if (fs.lstatSync(siblingLink, { throwIfNoEntry: false })) continue
          fs.symlinkSync(linkTarget(backlink, path.join(storeModules, sibling)), siblingLink, 'dir')
        }
      }
    }
  }
}

interface RestoreCliOptions {
  args: readonly string[]
  env: NodeJS.ProcessEnv
  isMain: boolean
  restore?: typeof restoreDeployedWorkspacePackages
}

export function runRestoreDeployedWorkspacePackagesCli({
  args,
  env,
  isMain,
  restore = restoreDeployedWorkspacePackages,
}: RestoreCliOptions): void {
  if (!isMain) return

  const prodDir = args[0] ?? env.PROD_DIR
  if (!prodDir) throw new Error('PROD_DIR or a directory argument is required')
  restore({ prodDir })
}
