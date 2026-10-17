import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { ghSpawnEnv } from './env.mts'

const execFileAsync = promisify(execFile)

/** A text-mode command runner: argv in, stdout out. Rejects on a non-zero exit. */
export type RunTextCommand = (args: string[]) => Promise<string>

/** The `child_process.execFile` shape `createCommandRunner` wraps — injectable for tests. */
export type ExecFileText = (
  command: string,
  args: string[],
  options?: { env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string }>

/**
 * Builds a `RunTextCommand` bound to a fixed binary. The default `exec` wraps `execFile` via
 * `promisify` so a test can inject a fake without spawning a real process; `runGh`/`runGit` below
 * are this factory applied to the two binaries this module cares about. `buildEnv` maps the
 * parent environment to the one the child is spawned with (identity by default).
 */
export function createCommandRunner(
  command: string,
  exec: ExecFileText = (cmd, args, options) => execFileAsync(cmd, args, { ...options, encoding: 'utf8' }),
  buildEnv: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv = (env) => env,
): RunTextCommand {
  return async (args) => {
    const { stdout } = await exec(command, args, { env: buildEnv(process.env) })
    return stdout
  }
}

/** Runs `gh` and returns its stdout, with `CLICOLOR_FORCE` removed so `--json` output stays plain. */
export const runGh: RunTextCommand = createCommandRunner('gh', undefined, ghSpawnEnv)

/** Runs `git` and returns its stdout. */
export const runGit: RunTextCommand = createCommandRunner('git')
