import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename } from 'node:path'

const LOCK_ATTEMPTS = 200
const STALE_LOCK_AGE_MS = 30_000
const LOCK_OWNER_MAX_BYTES = 32
const MAX_PID = 2_147_483_647
const LOCK_CREATE_FLAGS =
  constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW
const lockWait = new Int32Array(new SharedArrayBuffer(4))

function waitForLock(): void {
  // Intentional synchronous backoff for CLI and hook callers.
  Atomics.wait(lockWait, 0, 0, 5)
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

function isFresh(mtimeMs: number): boolean {
  const age = Date.now() - Math.floor(mtimeMs)
  return age > -STALE_LOCK_AGE_MS && age < STALE_LOCK_AGE_MS
}

function inspectLock(
  lockPath: string,
): { dev: number; ino: number; mtimeMs: number; owner: number | null } | null {
  let descriptor: number
  try {
    descriptor = openSync(
      lockPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
  } catch {
    /* v8 ignore next -- detects a lock that disappears or is replaced while being inspected. */
    return null
  }
  try {
    const status = fstatSync(descriptor)
    /* v8 ignore next -- opening a non-regular lock requires a platform-specific FIFO/device. */
    if (!status.isFile()) return null
    if (status.size > LOCK_OWNER_MAX_BYTES)
      return isFresh(status.mtimeMs)
        ? null
        : { dev: status.dev, ino: status.ino, mtimeMs: status.mtimeMs, owner: null }
    const buffer = Buffer.alloc(LOCK_OWNER_MAX_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const bytes = readSync(descriptor, buffer, length, buffer.length - length, length)
      if (bytes === 0) break
      length += bytes
    }
    /* v8 ignore next -- detects external growth after the descriptor metadata check. */
    if (length > LOCK_OWNER_MAX_BYTES) return null
    const rawOwner = buffer.subarray(0, length).toString()
    return {
      dev: status.dev,
      ino: status.ino,
      mtimeMs: status.mtimeMs,
      owner: /^[1-9][0-9]*$/.test(rawOwner) ? Number(rawOwner) : null,
    }
  } finally {
    closeSync(descriptor)
  }
}

function withReaperLock(lockPath: string, action: () => boolean): boolean {
  const reaperPath = `${lockPath}.reap`
  let descriptor: number
  try {
    descriptor = openSync(reaperPath, LOCK_CREATE_FLAGS, 0o600)
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
    const inspected = lstatSync(reaperPath)
    if (isFresh(inspected.mtimeMs)) return false
    const current = lstatSync(reaperPath)
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
      const inspected = inspectLock(lockPath)
      if (!inspected) return false
      const fresh = isFresh(inspected.mtimeMs)
      const { owner } = inspected
      if (typeof owner === 'number' && Number.isInteger(owner) && owner > 0 && owner <= MAX_PID) {
        try {
          process.kill(owner, 0)
          return false
        } catch (error) {
          if (!hasCode(error, 'ESRCH')) return false
        }
      } else if (fresh) return false
      const current = lstatSync(lockPath)
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
      descriptor = openSync(lockPath, LOCK_CREATE_FLAGS, 0o600)
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error
      let lockStatus
      try {
        lockStatus = lstatSync(lockPath)
      } catch (statusError) {
        /* v8 ignore next -- requires the owner to release between EEXIST and lstat. */
        if (hasCode(statusError, 'ENOENT')) continue
        /* v8 ignore next -- requires an unexpected lstat failure during the same race. */
        throw statusError
      }
      if (!lockStatus.isFile()) throw new Error('session-friction log lock must be a regular file')
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
