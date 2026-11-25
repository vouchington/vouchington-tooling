import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  serviceExitMessage,
  watchForPostReadyExit,
  type ManagedProcess,
  type ManagedProcessExit,
} from './exit-diagnostics.mts'
import { isHealthy, waitFor } from './wait.mts'

export interface StartManagedProcessOptions {
  name: string
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  logFilePrefix: string
  /** Directory where `<logFilePrefix>.log` is written. */
  logsDir: string
  /** Grace period before SIGKILL during `stop()`. Defaults to `5000` ms. */
  forceKillGraceMs?: number
  writeStdout?: (chunk: string) => void
  writeStderr?: (chunk: string) => void
}

/** Spawns a detached child process whose stdout/stderr are teed to `<logsDir>/<logFilePrefix>.log`. */
export function startManagedProcess(options: StartManagedProcessOptions): ManagedProcess {
  mkdirSync(options.logsDir, { recursive: true })
  const logPath = join(options.logsDir, `${options.logFilePrefix}.log`)
  const writeStdout = options.writeStdout ?? ((chunk: string) => void process.stdout.write(chunk))
  const writeStderr = options.writeStderr ?? ((chunk: string) => void process.stderr.write(chunk))
  const forceKillGraceMs = options.forceKillGraceMs ?? 5_000
  let exitStatus: ManagedProcessExit | null = null
  let exitedSettled = false
  let logStreamEnded = false
  let stopRequested = false
  const exitedDeferred = Promise.withResolvers<ManagedProcessExit>()
  const closedDeferred = Promise.withResolvers<void>()
  const logStream = createWriteStream(logPath, { flags: 'a' })

  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group so SIGKILL fallback can terminate the whole tree.
    detached: true,
  })

  child.stdout?.on('data', (chunk: Buffer) => {
    logStream.write(chunk)
    writeStdout(`[${options.logFilePrefix}] ${chunk.toString('utf8')}`)
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    logStream.write(chunk)
    writeStderr(`[${options.logFilePrefix}] ${chunk.toString('utf8')}`)
  })

  function finishLogStream(): void {
    if (!logStreamEnded) {
      logStreamEnded = true
      logStream.end(closedDeferred.resolve)
    }
  }

  function settleExited(exit: ManagedProcessExit, message?: string, endLog = false): void {
    if (exitedSettled) return

    exitedSettled = true
    exitStatus = exit
    const resolve = async (): Promise<void> => {
      if (endLog) finishLogStream()
      await closedDeferred.promise
      exitedDeferred.resolve(exit)
    }
    if (message) {
      writeStderr(message)
      logStream.write(message, () => {
        void resolve()
      })
      return
    }
    void resolve()
  }

  child.once('error', (error) => {
    settleExited(
      { code: null, error, signal: null },
      `[${options.logFilePrefix}] failed to start: ${error.message}\n`,
      true,
    )
  })

  child.once('exit', (code, signal) => {
    if (code !== null && code !== 0 && !child.killed) {
      settleExited({ code, signal }, `[${options.logFilePrefix}] exited with code ${code}\n`)
      return
    }
    settleExited({ code, signal })
  })
  child.once('close', finishLogStream)

  return {
    exited: exitedDeferred.promise,
    exitStatus: () => exitStatus,
    logPath,
    stop: async () => {
      if (exitStatus === null) {
        stopRequested = true
        await stopChild(child, forceKillGraceMs)
      }
      await exitedDeferred.promise
    },
    wasStopRequested: () => stopRequested,
  }
}

export interface WaitForServiceOptions {
  timeoutMs?: number
  intervalMs?: number
  write?: (chunk: string) => void
}

/** Waits until `url` returns one of `validStatuses`, failing early if `managedProcess` exits first. */
export async function waitForService(
  name: string,
  url: string,
  validStatuses: readonly number[] = [200],
  managedProcess?: ManagedProcess,
  options: WaitForServiceOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000
  const intervalMs = options.intervalMs ?? 500
  if (!managedProcess) {
    await waitFor(name, (signal) => isHealthy(url, validStatuses, signal), timeoutMs, intervalMs)
    return
  }

  const controller = new AbortController()
  const ready = waitFor(
    name,
    (signal) => isHealthy(url, validStatuses, signal),
    timeoutMs,
    intervalMs,
    controller.signal,
  )
  let active = true
  try {
    await Promise.race([
      ready,
      managedProcess.exited.then((exit) => {
        if (active) {
          throw new Error(serviceExitMessage(name, url, managedProcess.logPath, exit))
        }
        return undefined
      }),
    ])
  } finally {
    active = false
    controller.abort()
  }

  watchForPostReadyExit(name, managedProcess, options.write)
}

async function stopChild(child: ChildProcess, forceKillGraceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return

  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const forceKillTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }, forceKillGraceMs)

    child.once('exit', () => {
      clearTimeout(forceKillTimer)
      resolve()
    })
  })
}
