import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { waitForProcessGroupExit } from '../src/browser-session-runner/process-group.mts'

interface Identity {
  pid: number
  start: string
}

function readIdentity(pid: number): Identity | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/)
    if (fields[2] !== String(pid) || fields[3] !== String(pid) || !fields[19])
      throw new Error('SDK child is not its detached process group/session leader')
    return { pid, start: fields[19] }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Linux qualification helper: never signal a numeric group after its leader exits. */
export function captureOwnedChild(child: ChildProcess): () => boolean {
  if (process.platform !== 'linux')
    throw new Error('SDK process ownership qualification requires Linux')
  const identity = child.pid === undefined ? undefined : readIdentity(child.pid)
  return () => {
    if (child.exitCode !== null || child.signalCode !== null) return false
    if (!identity) throw new Error('SDK child process identity was not captured')
    const current = readIdentity(identity.pid)
    if (!current) return false
    if (current.start !== identity.start)
      throw new Error('SDK child PID identity changed; refusing group signal')
    try {
      process.kill(-identity.pid, 'SIGKILL')
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
      throw error
    }
  }
}

export interface ChildObservationOptions {
  capture?: typeof captureOwnedChild
  watchdogMs?: number
  closeGraceMs?: number
}

/** Install close/error observation before any operation that can fail after spawn. */
export async function observeSdkChild(child: ChildProcess, options: ChildObservationOptions = {}) {
  const errors: unknown[] = []
  let output = ''
  let closed = false
  let forcedCleanup = false
  let terminate: (() => boolean) | undefined
  const close = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once('error', (error) => {
      errors.push(error)
    })
    child.once('close', (code, signal) => {
      closed = true
      resolve({ code, signal })
    })
  })
  child.stdout?.on('data', (chunk) => {
    output += String(chunk)
  })
  child.stderr?.on('data', (chunk) => {
    output += String(chunk)
  })
  try {
    terminate = (options.capture ?? captureOwnedChild)(child)
  } catch (error) {
    errors.push(error)
  }
  const watchdogMs = options.watchdogMs ?? 5000
  let deadline: ReturnType<typeof setTimeout> | undefined
  const watchdog = setTimeout(() => {
    if (closed) return
    try {
      forcedCleanup = terminate?.() ?? false
      if (!forcedCleanup)
        errors.push(new Error('SDK deadline expired without a live owned group leader'))
    } catch (error) {
      errors.push(error)
    }
  }, watchdogMs)
  let result: { code: number | null; signal: string | null } | undefined
  try {
    result = await Promise.race([
      close,
      new Promise<undefined>((resolve) => {
        deadline = setTimeout(
          () => {
            errors.push(new Error('SDK child close barrier timed out; retaining live resources'))
            resolve(undefined)
          },
          watchdogMs + (options.closeGraceMs ?? 1000),
        )
      }),
    ])
  } finally {
    clearTimeout(watchdog)
    clearTimeout(deadline)
  }
  let groupDrained = child.pid === undefined
  try {
    if (child.pid !== undefined) {
      await waitForProcessGroupExit(child.pid, 1000)
      groupDrained = true
    }
  } catch (error) {
    errors.push(error)
  }
  if (result?.signal === null && forcedCleanup)
    errors.push(new Error('Vitest child required forced cleanup after CLI exit'))
  return { result, output, forcedCleanup, closed, drained: closed && groupDrained, errors }
}
