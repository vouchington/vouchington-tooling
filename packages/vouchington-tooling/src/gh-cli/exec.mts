import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** A text-mode command runner: argv in, stdout out. Rejects on a non-zero exit. */
export type RunTextCommand = (args: string[]) => Promise<string>

/** The `child_process.execFile` shape `createCommandRunner` wraps — injectable for tests. */
export type ExecFileText = (command: string, args: string[]) => Promise<{ stdout: string }>

/**
 * Builds a `RunTextCommand` bound to a fixed binary. The default `exec` wraps `execFile` via
 * `promisify` so a test can inject a fake without spawning a real process; `runGh`/`runGit` below
 * are this factory applied to the two binaries this module cares about.
 */
export function createCommandRunner(
  command: string,
  exec: ExecFileText = (cmd, args) => execFileAsync(cmd, args),
): RunTextCommand {
  return async (args) => {
    const { stdout } = await exec(command, args)
    return stdout
  }
}

/** Runs `gh` and returns its stdout. */
export const runGh: RunTextCommand = createCommandRunner('gh')

/** Runs `git` and returns its stdout. */
export const runGit: RunTextCommand = createCommandRunner('git')
