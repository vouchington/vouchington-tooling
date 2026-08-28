import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename } from 'node:path'

const LOCK_ATTEMPTS = 200
const STALE_LOCK_AGE_MS = 30_000
const lockWait = new Int32Array(new SharedArrayBuffer(4))

function waitForLock(): void {
  // Intentional synchronous backoff; Node 24 supports Atomics.wait on its main thread.
  Atomics.wait(lockWait, 0, 0, 5)
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

function withReaperLock(lockPath: string, action: () => boolean): boolean {
  const reaperPath = `${lockPath}.reap`
  let descriptor: number
  try {
    descriptor = openSync(reaperPath, 'wx', 0o600)
  } catch (error) {
    /* v8 ignore next 2 -- requires a narrow filesystem race or platform open failure. */
    if (hasCode(error, 'EEXIST') || hasCode(error, 'ENOENT')) return false
    /* v8 ignore next -- unexpected platform errors must propagate. */
    throw error
  }
  try {
    return action()
  } finally {
    closeSync(descriptor)
    try {
      unlinkSync(reaperPath)
    } catch {}
  }
}

function removeOrphanedReaper(reaperPath: string): boolean {
  try {
    const inspected = statSync(reaperPath)
    if (Date.now() - inspected.mtimeMs < STALE_LOCK_AGE_MS) return false
    const current = statSync(reaperPath)
    /* v8 ignore next 5 -- requires external replacement during stale-reaper recovery. */
    if (
      current.dev !== inspected.dev ||
      current.ino !== inspected.ino ||
      current.mtimeMs !== inspected.mtimeMs
    )
      return false
    unlinkSync(reaperPath)
    return true
  } catch {
    /* v8 ignore next -- requires external removal during stale-reaper recovery. */
    return false
  }
}

function removeStaleLock(lockPath: string): boolean {
  return withReaperLock(lockPath, () => {
    try {
      const inspected = statSync(lockPath)
      const fresh = Date.now() - inspected.mtimeMs < STALE_LOCK_AGE_MS
      const owner = Number(readFileSync(lockPath, 'utf8'))
      if (Number.isInteger(owner) && owner > 0) {
        try {
          process.kill(owner, 0)
          return false
        } catch (error) {
          if (!hasCode(error, 'ESRCH')) return false
        }
      } else if (fresh) return false
      const current = statSync(lockPath)
      /* v8 ignore next 5 -- requires external replacement despite the reaper protocol. */
      if (
        current.dev !== inspected.dev ||
        current.ino !== inspected.ino ||
        current.mtimeMs !== inspected.mtimeMs
      )
        return false
      unlinkSync(lockPath)
      return true
    } catch {
      return false
    }
  })
}

export function withFileLock<Result>(path: string, action: () => Result): Result {
  const lockPath = `${path}.lock`
  const reaperPath = `${lockPath}.reap`
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    if (existsSync(reaperPath)) {
      if (removeOrphanedReaper(reaperPath)) continue
      waitForLock()
      continue
    }
    let descriptor: number
    try {
      descriptor = openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error
      if (removeStaleLock(lockPath)) continue
      waitForLock()
      continue
    }
    try {
      writeFileSync(descriptor, String(process.pid))
      return action()
    } finally {
      closeSync(descriptor)
      unlinkSync(lockPath)
    }
  }
  throw new Error(`could not acquire session-friction log lock for ${basename(path)}`)
}
