import { execFile } from 'node:child_process'
import { globSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { parseWorktreeList } from '../git-worktrees/list.mts'

const execFileAsync = promisify(execFile)

// A path that no longer exists (a deleted worktree, a recorded cwd since removed) falls back to
// the literal string: canonicalization resolves symlinks, it does not validate.
async function safeRealpath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

export type RepoScopeDeps = {
  gitCommonDir?: (cwd: string) => Promise<string>
  gitWorktreePaths?: (cwd: string) => Promise<string[]>
}

export type RepoScopeOptions = {
  /** Explicit repository roots; relative paths resolve against `cwd`. Skips git entirely. */
  explicit?: string[]
  /**
   * Worktree layouts, as globs relative to each repository root, for checkouts that `git
   * worktree list` cannot report (for example a directory of worktrees that were since pruned).
   * Each match becomes an extra root.
   */
  worktreeGlobs?: string[]
  deps?: RepoScopeDeps
}

async function defaultGitCommonDir(cwd: string): Promise<string> {
  const args = ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']
  const { stdout } = await execFileAsync('git', args)
  return stdout.trim()
}

async function defaultGitWorktreePaths(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', [
    '-C',
    cwd,
    'worktree',
    'list',
    '--porcelain',
    '-z',
  ])
  return parseWorktreeList(stdout).map((record) => record.path)
}

function isWithinRoot(candidate: string, root: string): boolean {
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`
  return candidate === root || candidate.startsWith(boundary)
}

// Drops any root already inside another, so the per-file check stays a short list however many
// worktrees exist.
function minimizeRoots(roots: string[]): string[] {
  const unique = [...new Set(roots)]
  return unique.filter(
    (root) => !unique.some((other) => other !== root && isWithinRoot(root, other)),
  )
}

function expandGlobs(roots: string[], globs: string[]): string[] {
  return globs.flatMap((pattern) =>
    roots.flatMap((root) => globSync(pattern, { cwd: root }).map((match) => resolve(root, match))),
  )
}

async function baseRoots(cwd: string, options: RepoScopeOptions): Promise<string[]> {
  if (options.explicit !== undefined && options.explicit.length > 0) {
    return Promise.all(options.explicit.map((root) => safeRealpath(resolve(cwd, root))))
  }
  const gitCommonDir = options.deps?.gitCommonDir ?? defaultGitCommonDir
  const gitWorktreePaths = options.deps?.gitWorktreePaths ?? defaultGitWorktreePaths
  const [commonDir, worktrees] = await Promise.all([gitCommonDir(cwd), gitWorktreePaths(cwd)])
  return Promise.all([dirname(commonDir), ...worktrees].map(safeRealpath))
}

/**
 * The roots a run treats as "this repository": the explicit roots when given, otherwise the main
 * checkout unioned with every `git worktree list` entry, plus any `worktreeGlobs` matches, then
 * minimized. A git failure (not a repository, no `git`) rejects; callers report it and point at
 * the explicit roots. Every root is canonicalized once so a symlinked path compares correctly with
 * a transcript's recorded cwd.
 */
export async function resolveRepoRoots(
  cwd: string,
  options: RepoScopeOptions = {},
): Promise<string[]> {
  const roots = await baseRoots(cwd, options)
  const extra = await Promise.all(expandGlobs(roots, options.worktreeGlobs ?? []).map(safeRealpath))
  return minimizeRoots([...roots, ...extra])
}

/** Path-boundary safe: `/repo-two` never matches root `/repo` on a shared string prefix. */
export async function isWithinRepoRoots(cwd: string, roots: string[]): Promise<boolean> {
  const resolvedCwd = await safeRealpath(cwd)
  return roots.some((root) => isWithinRoot(resolvedCwd, root))
}
