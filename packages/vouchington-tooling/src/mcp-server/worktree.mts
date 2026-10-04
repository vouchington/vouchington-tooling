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

/** git's two "no worktree here" outcomes: outside any repository, and inside a `.git` directory. */
function isNotAGitRepository(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { stderr, message } = error as { stderr?: unknown; message?: unknown }
  return [stderr, message].some(
    (text) =>
      typeof text === 'string' && /not a git repository|must be run in a work tree/i.test(text),
  )
}

/**
 * The worktree root containing `cwd`, or undefined when git reports `cwd` is not inside one (so
 * the server may be launched from anywhere). Any other git failure, such as a missing git binary
 * or an unsafe repository, is thrown with the cause rather than reported as "outside a worktree".
 */
export async function launchWorktreeRoot(
  cwd: string,
  runGit: RunTextCommand,
): Promise<string | undefined> {
  let output: string
  try {
    output = await runGit(['-C', cwd, 'rev-parse', '--show-toplevel'])
  } catch (error) {
    if (isNotAGitRepository(error)) return undefined
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `git could not determine the worktree of ${cwd}: ${reason}. Check that git is installed and ` +
        'on PATH, that the directory exists, and that the repository is readable by this user ' +
        '(see safe.directory).',
      { cause: error },
    )
  }
  return realpath(output.trim())
}

/**
 * Resolves the worktree a tool call may act on. It must be an absolute path that, after
 * resolving symlinks, is exactly the top level of a git worktree (of any repository on the
 * machine). A subdirectory, a relative or nonexistent path, and a non-git directory are rejected.
 * Git is asked on every call, so worktrees created after the server started are accepted and
 * removed ones are not. Without `requested`, the launch worktree is used when there is one.
 */
export async function resolveWorktree(input: {
  launchRoot: string | undefined
  requested?: string | undefined
  runGit: RunTextCommand
}): Promise<string> {
  const { launchRoot, requested, runGit } = input
  if (requested === undefined && launchRoot === undefined)
    throw new Error(
      'worktree is required: this server was launched outside a git worktree, so pass ' +
        'worktree as the absolute path of the git worktree to act on',
    )
  const path = requested ?? (launchRoot as string)
  if (!isAbsolute(path)) throw new Error('worktree must be an absolute path to a git worktree')
  const target = await canonical(path)
  if (target !== undefined && (await launchWorktreeRoot(target, runGit)) === target) return target
  throw new Error(
    `worktree ${path} is not the top level of a git worktree: it must exist and be the ` +
      'directory `git rev-parse --show-toplevel` reports, not a subdirectory of it',
  )
}
