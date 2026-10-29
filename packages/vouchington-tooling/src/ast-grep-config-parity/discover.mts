import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join, posix, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { AstGrepConfigParityFile } from './check.mts'

const execFileAsync = promisify(execFile)

export type GitLsFilesRunner = (root: string, dir: string) => Promise<string[]>

export interface DiscoverAstGrepConfigOptions {
  /** Tracked local rule directory, relative to `root`. */
  localRuleDir: string
  /** Defaults to `sgconfig.yml`. */
  sgconfigPath?: string
  /** Installed pack rules directory (absolute, or relative to `root`). Listed from disk. */
  packRulesDir: string
  /** Allow zero local rule files instead of throwing. Defaults to `false`. */
  allowEmpty?: boolean
  /** Replaces the `git ls-files` runner; returns root-relative tracked paths under `dir`. */
  listTrackedFiles?: GitLsFilesRunner
}

export interface AstGrepConfigParityInput {
  sgconfig: { name: string; source: string }
  localRuleDir: string
  localRules: AstGrepConfigParityFile[]
  packRulePaths: string[]
}

const YAML_FILE = /\.ya?ml$/
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : 1)

/** Runs `git ls-files -z -- <dir>` with an argv array (no shell) from `root`. */
export async function gitLsFiles(root: string, dir: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', dir], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout.split('\0').filter(Boolean)
}

/**
 * Reads `sgconfig.yml`, the git-tracked `*.yml`/`*.yaml` files under `localRuleDir` (recursive) and
 * the installed pack's rule paths, returning the inputs of `checkAstGrepConfigParity`. Throws when
 * local discovery is empty (unless `allowEmpty`) or the pack directory has no rule files.
 */
export async function discoverAstGrepConfig(
  root: string,
  options: DiscoverAstGrepConfigOptions,
): Promise<AstGrepConfigParityInput> {
  const { localRuleDir } = options
  const dir = posix.normalize(localRuleDir).replace(/\/+$/, '')
  const sgconfigPath = options.sgconfigPath ?? 'sgconfig.yml'
  const tracked = await (options.listTrackedFiles ?? gitLsFiles)(root, dir)
  const prefix = `${dir}/`
  const paths = tracked
    .filter((path) => path.startsWith(prefix) && YAML_FILE.test(path))
    .map((path) => path.slice(prefix.length))
    .sort(byCodeUnit)
  if (paths.length === 0 && !options.allowEmpty) {
    throw new Error(`No git-tracked ast-grep rule files found under ${join(root, dir)}`)
  }
  const packDir = resolve(root, options.packRulesDir)
  const packRulePaths = (await readdir(packDir, { recursive: true }))
    .map((path) => path.split('\\').join('/'))
    .filter((path) => YAML_FILE.test(path))
    .sort(byCodeUnit)
  if (packRulePaths.length === 0) {
    throw new Error(`No ast-grep pack rule files found under ${packDir}`)
  }
  const [source, localRules] = await Promise.all([
    readFile(join(root, sgconfigPath), 'utf8'),
    Promise.all(
      paths.map(async (path) => ({
        path,
        source: await readFile(join(root, dir, path), 'utf8'),
      })),
    ),
  ])
  return { sgconfig: { name: sgconfigPath, source }, localRuleDir, localRules, packRulePaths }
}
