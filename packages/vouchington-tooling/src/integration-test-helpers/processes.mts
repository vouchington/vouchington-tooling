import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ManagedProcess, ManagedProcessExit } from './exit-diagnostics.mts'

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
  let logStreamClosed = false
  let spawned = false
  let stopRequested = false
  let stopPromise: Promise<void> | undefined
  const exitedDeferred = Promise.withResolvers<ManagedProcessExit>()
  const closedDeferred = Promise.withResolvers<void>()
  const childTerminated = Promise.withResolvers<void>()
  const logStream = createWriteStream(logPath, { flags: 'a' })

  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group so SIGTERM/SIGKILL terminate the whole tree.
    detached: true,
  })
  child.once('spawn', () => {
    spawned = true
  })

  const writeLog = (chunk: Buffer | string): void => {
    if (!logStreamClosed) logStream.write(chunk)
  }
  const finishLogStream = (): void => {
    if (!logStreamClosed) {
      logStreamClosed = true
      logStream.end(closedDeferred.resolve)
    }
  }
  const requestStop = (): Promise<void> => {
    stopRequested = true
    return (stopPromise ??= stopChild(
      child,
      forceKillGraceMs,
      childTerminated.promise,
      () => spawned,
    ).catch((error) => {
      stopPromise = undefined
      throw error
    }))
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
      logStream.write(message, () => void resolve())
      return
    }
    void resolve()
  }

  logStream.on('error', (error) => {
    logStreamClosed = true
    closedDeferred.resolve()
    writeStderr(`[${options.logFilePrefix}] log stream error: ${error.message}\n`)
    settleExited({ code: null, error, signal: null })
    void requestStop()
  })

  child.stdout?.on('data', (chunk: Buffer) => {
    writeLog(chunk)
    writeStdout(`[${options.logFilePrefix}] ${chunk.toString('utf8')}`)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    writeLog(chunk)
    writeStderr(`[${options.logFilePrefix}] ${chunk.toString('utf8')}`)
  })
  child.on('error', (error) => {
    if (spawned) return
    childTerminated.resolve()
    settleExited(
      { code: null, error, signal: null },
      `[${options.logFilePrefix}] failed to start: ${error.message}\n`,
      true,
    )
  })
  child.once('exit', (code, signal) => {
    if (code !== null && code !== 0 && !stopRequested && !child.killed) {
      settleExited({ code, signal }, `[${options.logFilePrefix}] exited with code ${code}\n`)
      return
    }
    settleExited({ code, signal })
  })
  child.once('close', () => {
    childTerminated.resolve()
    finishLogStream()
  })

  return {
    exited: exitedDeferred.promise,
    exitStatus: () => exitStatus,
    logPath,
    stop: async () => {
      if (stopPromise) await stopPromise
      else if (exitStatus === null) await requestStop()
      await exitedDeferred.promise
    },
    wasStopRequested: () => stopRequested,
  }
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // Fall back to signaling the direct child if group signaling fails.
    }
  }
  child.kill(signal)
}

async function stopChild(
  child: ChildProcess,
  forceKillGraceMs: number,
  terminated: Promise<void>,
  hasSpawned: () => boolean,
): Promise<void> {
  const killFailure = Promise.withResolvers<never>()
  const onKillError = (error: Error): void => {
    if (hasSpawned()) killFailure.reject(error)
  }
  child.on('error', onKillError)
  signalProcessTree(child, 'SIGTERM')
  const forceKillTimer = setTimeout(() => signalProcessTree(child, 'SIGKILL'), forceKillGraceMs)
  try {
    await Promise.race([terminated, killFailure.promise])
  } finally {
    clearTimeout(forceKillTimer)
    child.off('error', onKillError)
  }
}
