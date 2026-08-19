import { spawn } from 'node:child_process'

// oxfmt-ignore
import { INSTALL_TERMINATION_FAILED, installExitCode, startInstallHeartbeat, terminateSafeProcessGroup } from './process.mts'
import type { CommandResult, InstallOptions } from './support.mts'

/**
 * Spawn one `pnpm` attempt. Both stdout and stderr are always captured (so a terminal failure
 * like a release-age violation can be classified from `errorOutput`) and, unless `capture` is
 * set, forwarded live to the parent process's streams — `capture` is for structured calls (e.g.
 * `pnpm m ls --json`) whose stdout the caller parses rather than displays.
 */
export function runPnpm(
  args: string[],
  options: InstallOptions,
  capture = false,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const errorOutput: Buffer[] = []
    const output: Buffer[] = []
    // oxfmt-ignore
    const result = (code: number): CommandResult => ({ code, errorOutput: Buffer.concat(errorOutput).toString(), output: Buffer.concat(output).toString() })
    let completed = false
    const complete = (result: CommandResult) => {
      if (completed) return
      completed = true
      resolve(result)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('pnpm', args, {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`pnpm failed to spawn: ${message}`)
      complete({ code: 1, errorOutput: message, output: '' })
      return
    }
    child.stdout?.on('data', (data) => {
      output.push(data)
      if (!capture) process.stdout.write(data)
    })
    child.stderr?.on('data', (data) => {
      errorOutput.push(data)
      if (!capture) process.stderr.write(data)
    })
    child.once('error', (error) => {
      console.error(`pnpm failed to start: ${error.message}`)
      complete({ code: 1, errorOutput: error.message, output: '' })
    })
    const heartbeat = startInstallHeartbeat()
    let termination: Promise<boolean> | undefined
    // Benign race: if the timeout callback and the 'close' handler both fire, `complete`'s dedup
    // guard lets only the first resolve. `timedOut` is only read by the winner, so whichever wins
    // sees the correct value for its own case (true when the timeout won, false when close won).
    let timedOut = false
    const terminate = () => (termination ??= terminateSafeProcessGroup(child.pid))
    const timeout =
      options.commandTimeoutSeconds === 0
        ? undefined
        : setTimeout(() => {
            /* v8 ignore next -- close can win the race and already settle */
            if (completed) return
            timedOut = true
            void terminate()
              .then((stopped) => complete(result(stopped ? 1 : INSTALL_TERMINATION_FAILED)))
              .catch((error) => {
                console.error(`pnpm install termination failed: ${String(error)}`)
                complete(result(INSTALL_TERMINATION_FAILED))
              })
              .finally(() => {
                clearInterval(heartbeat)
              })
          }, options.commandTimeoutSeconds * 1000)
    timeout?.unref()
    child.once('close', async (code) => {
      try {
        await termination
        complete(result(installExitCode(code, timedOut)))
      } finally {
        clearInterval(heartbeat)
        // oxlint-disable-next-line promise/no-multiple-resolved -- oxlint reports the multi-path settlement at this finally line; the sole `resolve` call site is first-winner-guarded by `completed` inside `complete`
        if (timeout) clearTimeout(timeout)
      }
    })
  })
}
