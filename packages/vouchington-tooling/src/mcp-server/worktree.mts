import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { createCommandRunner, type RunTextCommand } from '../gh-cli/exec.mts'
import { gitEnv } from '../shared-context/index.mts'

const execFileAsync = promisify(execFile)

/** Runs git without inherited `GIT_*` variables so `GIT_DIR` cannot redirect the check. */
export const runIsolatedGit: RunTextCommand = createCommandRunner('git', (command, args) =>
  execFileAsync(command, args, { env: gitEnv() }),
)

async function canonical(path: string): Promise<string | undefined> {
  try {
    return await realpath(path)
  } catch {
    return undefined
  }
}

/** The worktree root containing `cwd`, or a message that says how to fix the launch directory. */
export async function launchWorktreeRoot(cwd: string, runGit: RunTextCommand): Promise<string> {
  try {
    return await realpath((await runGit(['-C', cwd, 'rev-parse', '--show-toplevel'])).trim())
  } catch (error) {
    throw new Error(
      `vouchington mcp must be launched inside a git worktree; ${cwd} is not one (${errorText(error)})`,
    )
  }
}

/** Paths of the non-bare entries in `git worktree list --porcelain` output. */
export function parseWorktreeList(porcelain: string): string[] {
  const paths: string[] = []
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/)
    const first = lines.find((line) => line.startsWith('worktree '))
    if (first !== undefined && !lines.includes('bare')) paths.push(first.slice('worktree '.length))
  }
  return paths
}

/**
 * Resolves the worktree a tool call may act on. The list is read from git on every call, so
 * worktrees created after the server started are accepted and removed ones are not. The
 * comparison is exact on real paths: a subdirectory of a worktree, or an unrelated repository,
 * is rejected.
 */
export async function resolveWorktree(input: {
  launchRoot: string
  requested?: string | undefined
  runGit: RunTextCommand
}): Promise<string> {
  const { launchRoot, requested, runGit } = input
  if (requested !== undefined && !isAbsolute(requested))
    throw new Error('worktree must be an absolute path to a git worktree of the launch repository')
  const target = requested === undefined ? launchRoot : await canonical(requested)
  const listing = await runGit(['-C', launchRoot, 'worktree', 'list', '--porcelain'])
  const known = (await Promise.all(parseWorktreeList(listing).map(canonical))).filter(
    (path): path is string => path !== undefined,
  )
  if (target !== undefined && known.includes(target)) return target
  throw new Error(
    `worktree ${requested ?? launchRoot} is not a worktree of the repository this server was ` +
      `launched from (${launchRoot}). Registered worktrees: ${known.join(', ')}`,
  )
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
