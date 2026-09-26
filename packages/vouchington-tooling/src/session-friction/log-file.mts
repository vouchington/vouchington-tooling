import { closeSync, constants, fstatSync, openSync, readSync, writeSync } from 'node:fs'
import { isSafeAuditText } from './text.mts'
import type { FrictionEvent } from './types.mts'
import { decodeUtf8 } from './utf8.mts'

export const LOG_MAX_BYTES = 2_000_000

export function validEvent(value: unknown): value is FrictionEvent {
  if (!value || typeof value !== 'object') return false
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- establish a record view after the runtime object check
  const record = value as Record<string, unknown>
  return (
    (record.kind === 'sandbox-escalation' || record.kind === 'sandbox-failure') &&
    isSafeAuditText(record.timestamp) &&
    isSafeAuditText(record.commandPrefix) &&
    isSafeAuditText(record.detail)
  )
}

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
      throw new Error('session-friction log must be a regular file')
    throw error
  }
  try {
    const status = fstatSync(descriptor)
    if (!status.isFile() || status.nlink !== 1)
      throw new Error('session-friction log must be a regular file')
    return descriptor
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}
export function readLogContent(descriptor: number): string {
  if (fstatSync(descriptor).size > LOG_MAX_BYTES)
    throw new Error('session-friction log is too large')
  const buffer = Buffer.alloc(LOG_MAX_BYTES + 1)
  let length = 0
  while (length < buffer.length) {
    const bytes = readSync(descriptor, buffer, length, buffer.length - length, length)
    if (bytes === 0) break
    length += bytes
  }
  /* v8 ignore next -- detects external growth after the descriptor size check. */
  if (length > LOG_MAX_BYTES) throw new Error('session-friction log is too large')
  return decodeUtf8(buffer.subarray(0, length))
}

function validEventCount(content: string, limit: number): number {
  let count = 0
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      if (validEvent(JSON.parse(line))) count++
    } catch {}
    if (count >= limit) break
  }
  return count
}

export function atEventLimit(content: string, limit: number): boolean {
  return validEventCount(content, limit) >= limit
}

export function writeAll(descriptor: number, value: string): void {
  const buffer = Buffer.from(value)
  let offset = 0
  while (offset < buffer.length) {
    const written = writeSync(descriptor, buffer, offset, buffer.length - offset)
    /* v8 ignore next -- a zero-byte synchronous file write is an external I/O failure. */
    if (written === 0) throw new Error('session-friction log write made no progress')
    offset += written
  }
}
