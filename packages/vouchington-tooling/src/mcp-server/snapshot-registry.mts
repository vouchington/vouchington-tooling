import { randomBytes } from 'node:crypto'
import type {
  SnapshotChecksum,
  SnapshotCleanupReceipt,
  SnapshotCounts,
} from '../agent-blackboard/snapshot-types.mts'

/** What the server itself recorded when it exported a snapshot. Never read from a caller. */
export type SnapshotRecord = {
  sessionId: string
  worktree: string
  path: string
  /** The exporting client's own capability; kept server-side and never returned to a caller. */
  clientToken?: string
  /** What the export reported, so a partition verifies the file against the server's own record. */
  checksum?: SnapshotChecksum
  counts?: SnapshotCounts
  directory?: string
  receipt?: SnapshotCleanupReceipt
}

export type SnapshotRegistry = {
  /** Records an export and returns the server-minted, unguessable cleanup token. */
  register: (record: SnapshotRecord) => string
  /** Removes and returns the record when the token is known and bound to this caller. */
  take: (token: string, sessionId: string, worktree: string) => SnapshotRecord
  /** Puts a taken record back after a failed cleanup so the same token can retry. */
  restore: (token: string, record: SnapshotRecord) => void
}

export const MAX_RECORDS = 256

const REJECTED =
  'cleanupToken is unknown, already used, or bound to another session or worktree; nothing was deleted'

/**
 * Tokens live in memory only. A server restart forgets every binding, so an old token is then
 * rejected as unknown and the file is left for the operating system to reap from its temp directory.
 */
export function createSnapshotRegistry(): SnapshotRegistry {
  const records = new Map<string, SnapshotRecord>()
  const store = (token: string, record: SnapshotRecord): void => {
    records.set(token, record)
    // A long-lived server must not grow without bound; the oldest export is forgotten first.
    while (records.size > MAX_RECORDS) records.delete(records.keys().next().value as string)
  }
  return {
    register(record) {
      const token = randomBytes(32).toString('base64url')
      store(token, record)
      return token
    },
    take(token, sessionId, worktree) {
      const record = records.get(token)
      // One message for every rejection, so a probe learns nothing about other sessions' tokens.
      if (!record || record.sessionId !== sessionId || record.worktree !== worktree)
        throw new Error(REJECTED)
      records.delete(token)
      return record
    },
    restore: store,
  }
}
