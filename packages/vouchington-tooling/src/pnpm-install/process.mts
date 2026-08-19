import { scheduler } from 'node:timers/promises'

const TERM_GRACE_SECONDS = 10
const KILL_GRACE_SECONDS = 10
const HEARTBEAT_SECONDS = 30
export const INSTALL_TERMINATION_FAILED = -1

export function safeProcessGroup(pid: number | undefined): number | undefined {
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

export function installExitCode(code: number | null, timedOut: boolean): number {
  return timedOut ? 1 : (code ?? 1)
}

export function startInstallHeartbeat(): NodeJS.Timeout {
  const started = performance.now()
  const heartbeat = setInterval(() => {
    console.warn(
      `pnpm install still running after ${Math.floor((performance.now() - started) / 1000)}s`,
    )
  }, HEARTBEAT_SECONDS * 1000)
  heartbeat.unref()
  return heartbeat
}

export type ProcessGroupSupervisor = {
  isAlive: (processGroup: number) => boolean
  signal: (processGroup: number, signal: NodeJS.Signals) => void
  waitForExit: (processGroup: number, timeoutMs: number) => Promise<boolean>
}

function processGroupExists(processGroup: number) {
  try {
    // oxlint-disable-next-line no-restricted-properties -- the installer must verify its detached process group has stopped
    process.kill(-processGroup, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function waitForProcessGroupExit(processGroup: number, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs
  while (processGroupExists(processGroup)) {
    /* v8 ignore next -- a live group that outlasts both grace windows is host-specific */
    if (performance.now() >= deadline) return false
    await scheduler.wait(100)
  }
  return true
}

const processGroupSupervisor: ProcessGroupSupervisor = {
  isAlive: processGroupExists,
  signal(processGroup, signal) {
    // oxlint-disable-next-line no-restricted-properties -- the installer must terminate the detached process group before retrying
    process.kill(-processGroup, signal)
  },
  waitForExit: waitForProcessGroupExit,
}

export async function terminateProcessGroup(
  processGroup: number,
  supervisor: ProcessGroupSupervisor = processGroupSupervisor,
): Promise<boolean> {
  const signal = (value: NodeJS.Signals) => {
    try {
      supervisor.signal(processGroup, value)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
      throw error
    }
  }
  if (!supervisor.isAlive(processGroup)) return true
  console.warn(`pnpm install process group ${processGroup} exceeded its deadline; sending TERM`)
  if (!signal('SIGTERM')) return true
  if (await supervisor.waitForExit(processGroup, TERM_GRACE_SECONDS * 1000)) return true
  console.warn(`pnpm install process group ${processGroup} ignored TERM; sending KILL`)
  if (!signal('SIGKILL')) return true
  if (await supervisor.waitForExit(processGroup, KILL_GRACE_SECONDS * 1000)) return true
  console.error(
    `pnpm install process group ${processGroup} survived SIGKILL for ${KILL_GRACE_SECONDS}s; refusing to overlap another attempt`,
  )
  return false
}

export function terminateSafeProcessGroup(pid: number | undefined): Promise<boolean> {
  const processGroup = safeProcessGroup(pid)
  if (processGroup !== undefined) return terminateProcessGroup(processGroup)
  console.error('pnpm install timed out before a safe child process group was available')
  return Promise.resolve(false)
}
