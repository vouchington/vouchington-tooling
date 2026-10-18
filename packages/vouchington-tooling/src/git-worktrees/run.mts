import { execFileSync } from 'node:child_process'

export interface RunOptions {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

/** Runs a command without a shell; returns stdout, or undefined when it fails to start or exits non-zero. */
export function run(
  file: string,
  args: readonly string[],
  options: RunOptions,
): string | undefined {
  try {
    return execFileSync(file, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 120_000,
    })
  } catch {
    return undefined
  }
}

// Repo-local overrides (see `git rev-parse --local-env-vars`): the cwd must pick the repository.
const LOCAL_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_GRAFT_FILE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_REPLACE_REF_BASE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_QUARANTINE_PATH',
]

/** git with fsmonitor disabled so a repository config can never execute a hook. */
export function git(args: readonly string[], options: RunOptions): string | undefined {
  const env = { ...options.env }
  for (const name of LOCAL_ENV) delete env[name]
  return run('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: options.cwd, env })
}
