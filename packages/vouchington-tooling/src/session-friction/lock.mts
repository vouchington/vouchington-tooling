import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'

const LOCK_ATTEMPTS = 200
const STALE_LOCK_AGE_MS = 30_000
const lockWait = new Int32Array(new SharedArrayBuffer(4))

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

function removeStaleLock(lockPath: string): boolean {
  return withReaperLock(lockPath, () => {
    try {
      const fresh = Date.now() - statSync(lockPath).mtimeMs < STALE_LOCK_AGE_MS
      const owner = Number(readFileSync(lockPath, 'utf8'))
      if (Number.isInteger(owner) && owner > 0) {
        try {
          process.kill(owner, 0)
          return false
        } catch (error) {
          if (!hasCode(error, 'ESRCH')) return false
        }
      } else if (fresh) return false
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
      Atomics.wait(lockWait, 0, 0, 5)
      continue
    }
    let descriptor: number
    try {
      descriptor = openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error
      if (removeStaleLock(lockPath)) continue
      Atomics.wait(lockWait, 0, 0, 5)
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
  throw new Error('could not acquire session-friction log lock')
}
