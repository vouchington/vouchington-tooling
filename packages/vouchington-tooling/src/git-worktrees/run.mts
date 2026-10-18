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

/** git with fsmonitor disabled so a repository config can never execute a hook. */
export function git(args: readonly string[], options: RunOptions): string | undefined {
  return run('git', ['-c', 'core.fsmonitor=false', ...args], options)
}
