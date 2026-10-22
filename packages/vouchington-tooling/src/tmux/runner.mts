import { spawnSync } from 'node:child_process'

export type TmuxResult = { status: number | null; stdout: string }

/** Runs one tmux command. `inherit` hands the terminal to tmux (attach). */
export type TmuxRun = (args: readonly string[], inherit?: boolean) => TmuxResult

export function createTmuxRun(bin: string): TmuxRun {
  return (args, inherit = false) => {
    const result = spawnSync(bin, [...args], {
      encoding: 'utf8',
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'ignore'],
    })
    return { status: result.error ? null : result.status, stdout: result.stdout ?? '' }
  }
}

/** True when the process has any child process (the window's command is running). */
export function pgrepHasChildren(pid: string): boolean {
  return spawnSync('pgrep', ['-P', pid, '.'], { stdio: 'ignore' }).status === 0
}

export function sleepMs(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}
