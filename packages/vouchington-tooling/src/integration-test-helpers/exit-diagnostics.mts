import { readRecentLog } from './log-tail.mts'
import { isHealthy, waitFor } from './wait.mts'

export interface ManagedProcessExit {
  code: number | null
  error?: Error
  signal: NodeJS.Signals | null
}

export interface ManagedProcess {
  exited: Promise<ManagedProcessExit>
  exitStatus: () => ManagedProcessExit | null
  logPath: string
  stop: () => Promise<void>
  wasStopRequested: () => boolean
}

export const POST_READY_EXIT_MARKER_PREFIX = '[processes] managed process'

export function formatExitStatus(exit: ManagedProcessExit): string {
  if (exit.error) return `error ${exit.error.message}`
  if (exit.code === null) return `signal ${exit.signal ?? 'unknown'}`
  return `code ${String(exit.code)}`
}

function logDiagnosticLines(headline: string, logPath: string): string {
  const logTail = readRecentLog(logPath)
  return [
    headline,
    `Service log: ${logPath}`,
    logTail ? `Recent service log:\n${logTail}` : 'Recent service log: <empty>',
  ].join('\n')
}

export function serviceExitMessage(
  name: string,
  url: string,
  logPath: string,
  exit: ManagedProcessExit,
): string {
  return logDiagnosticLines(
    `Service ${name} exited with ${formatExitStatus(exit)} before becoming ready at ${url}.`,
    logPath,
  )
}

/**
 * Watches a managed process after readiness and writes a clear diagnostic marker if it crashes
 * unexpectedly before `stop()` is requested.
 */
export function watchForPostReadyExit(
  name: string,
  managedProcess: ManagedProcess,
  write: (chunk: string) => void = (chunk) => {
    process.stderr.write(chunk)
  },
): void {
  void managedProcess.exited.then((exit) => {
    if (managedProcess.wasStopRequested()) {
      return
    }
    write(
      `${logDiagnosticLines(
        `${POST_READY_EXIT_MARKER_PREFIX} ${name} exited unexpectedly after ready: ${formatExitStatus(exit)}`,
        managedProcess.logPath,
      )}\n`,
    )
  })
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
        if (active) throw new Error(serviceExitMessage(name, url, managedProcess.logPath, exit))
        return undefined
      }),
    ])
  } finally {
    active = false
    controller.abort()
  }

  watchForPostReadyExit(name, managedProcess, options.write)
}
