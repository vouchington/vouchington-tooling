import { closeSync, openSync, readSync, statSync } from 'node:fs'

/** Reads up to the final `maxBytes` (default 4000) of a log file, returning `''` on missing/empty files. */
export function readRecentLog(logPath: string, maxBytes = 4_000): string {
  let fd: number | null = null
  try {
    const size = statSync(logPath).size
    if (size === 0) {
      return ''
    }
    const bytesToRead = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(bytesToRead)
    fd = openSync(logPath, 'r')
    readSync(fd, buffer, 0, bytesToRead, size - bytesToRead)
    return buffer.toString('utf8').trim()
  } catch {
    return ''
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // Ignore close failures while reporting the original service failure.
      }
    }
  }
}
