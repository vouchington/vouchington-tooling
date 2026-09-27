import { closeSync, constants, fsyncSync, lstatSync, openSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { openLogFile, readLogContent, writeAll, LOG_MAX_BYTES } from './log-file.mts'
export type CoverageLedger = {
  schemaVersion: 1
  retainedEvents: number
  logBytes: number
  droppedCount: number
}
const LEDGER_MAX_BYTES = 192
function missing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}
/** Caller holds the event log lock; incomplete atomic updates must never imply complete capture. */
export function readCoverageLedger(path: string): CoverageLedger | undefined {
  try {
    lstatSync(`${path}.coverage.pending`)
    throw new Error('session-friction coverage update is incomplete')
  } catch (error) {
    if (!missing(error)) throw error
  }
  let descriptor: number
  try {
    descriptor = openLogFile(`${path}.coverage`, constants.O_RDONLY)
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
  try {
    const value: unknown = JSON.parse(readLogContent(descriptor, LEDGER_MAX_BYTES))
    if (!value || typeof value !== 'object')
      throw new Error('invalid session-friction coverage ledger')
    // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- establish a validated object view
    const item = value as Record<string, unknown>
    if (
      Object.keys(item).length !== 4 ||
      item.schemaVersion !== 1 ||
      !Number.isSafeInteger(item.retainedEvents) ||
      (item.retainedEvents as number) < 0 ||
      (item.retainedEvents as number) > 500 ||
      !Number.isSafeInteger(item.logBytes) ||
      (item.logBytes as number) < 0 ||
      (item.logBytes as number) > LOG_MAX_BYTES ||
      !Number.isSafeInteger(item.droppedCount) ||
      (item.droppedCount as number) < 1
    )
      throw new Error('invalid session-friction coverage ledger')
    return item as CoverageLedger
  } finally {
    closeSync(descriptor)
  }
}
/** The fixed-size atomic sidecar keeps saturation work independent of the accumulated drop count. */
export function writeCoverageLedger(path: string, ledger: CoverageLedger): void {
  if (!Number.isSafeInteger(ledger.droppedCount))
    throw new Error('session-friction dropped count overflow; capture incomplete')
  const temporary = `${path}.coverage.pending`
  const descriptor = openSync(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    syncDirectory(path)
    writeAll(descriptor, JSON.stringify(ledger))
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporary, `${path}.coverage`)
  syncDirectory(path)
}
function syncDirectory(path: string): void {
  const descriptor = openSync(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
