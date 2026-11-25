import { readRecentLog } from './log-tail.mts'

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
