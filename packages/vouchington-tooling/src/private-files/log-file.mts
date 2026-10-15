import { closeSync, constants, fstatSync, openSync, readSync, writeSync } from 'node:fs'
import { decodeUtf8 } from './utf8.mts'

export function openLogFile(path: string, flags: number): number {
  let descriptor: number
  try {
    descriptor = openSync(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ELOOP' || error.code === 'EISDIR' || error.code === 'ENOTDIR')
    )
      throw new Error('log file must be a regular file')
    throw error
  }
  try {
    const status = fstatSync(descriptor)
    if (!status.isFile() || status.nlink !== 1) throw new Error('log file must be a regular file')
    return descriptor
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}
export function readLogContent(descriptor: number, maximumBytes: number): string {
  if (fstatSync(descriptor).size > maximumBytes) throw new Error('log file is too large')
  const buffer = Buffer.alloc(maximumBytes + 1)
  let length = 0
  while (length < buffer.length) {
    const bytes = readSync(descriptor, buffer, length, buffer.length - length, length)
    if (bytes === 0) break
    length += bytes
  }
  /* v8 ignore next -- detects external growth after the descriptor size check. */
  if (length > maximumBytes) throw new Error('log file is too large')
  return decodeUtf8(buffer.subarray(0, length))
}

export function writeAll(descriptor: number, value: string): void {
  const buffer = Buffer.from(value)
  let offset = 0
  while (offset < buffer.length) {
    const written = writeSync(descriptor, buffer, offset, buffer.length - offset)
    /* v8 ignore next -- a zero-byte synchronous file write is an external I/O failure. */
    if (written === 0) throw new Error('log file write made no progress')
    offset += written
  }
}
