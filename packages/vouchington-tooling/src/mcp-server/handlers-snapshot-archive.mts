import { archiveBlackboardSession } from '../agent-blackboard/index.mts'
import { assertSessionId } from '../agent-blackboard/session-id.mts'
import { requiredString, requiredStringArray } from './args.mts'
import type { ToolHandler } from './context.mts'
import { readEntriesIfPresent } from './journal-read.mts'
import { entryDigest, readExportedDigests } from './snapshot-entry-digests.mts'

const MAX_ARCHIVE_SESSIONS = 100
const MAX_REASON = 200

type Skipped = { sessionId: string; reason: string }

function readSessionIds(value: string[]): string[] {
  if (value.length > MAX_ARCHIVE_SESSIONS)
    throw new Error(`sessionIds holds at most ${MAX_ARCHIVE_SESSIONS} session ids`)
  for (const id of value) assertSessionId(id)
  return [...new Set(value)]
}

function sameEntries(exported: Set<string>, live: unknown[]): boolean {
  const current = new Set(live.map((entry) => entryDigest((entry as { data?: unknown }).data)))
  return current.size === exported.size && [...current].every((digest) => exported.has(digest))
}

/**
 * Archives each listed session whose live entries still match the ones `snapshot_export` recorded.
 * The server reads the snapshot and the live journal itself, so no entry content reaches the
 * caller: the result names only the sessions archived and a reason for each one skipped. The
 * token is only read, never spent, so `snapshot_cleanup` can still use it.
 */
export const snapshotArchive: ToolHandler = async (args, context) => {
  const token = requiredString(args, 'cleanupToken')
  const sessionIds = readSessionIds(requiredStringArray(args, 'sessionIds'))
  const record = context.snapshots.take(token, context.sessionId, context.worktree)
  const archived: string[] = []
  const skipped: Skipped[] = []
  try {
    const exported = await readExportedDigests(record.path, new Set(sessionIds), record.checksum)
    for (const sessionId of sessionIds) {
      const expected = exported.get(sessionId)
      if (expected === undefined) {
        skipped.push({ sessionId, reason: 'not in the export' })
        continue
      }
      try {
        const live = await readEntriesIfPresent(sessionId, context.env, context.dependencies)
        if (live === undefined) skipped.push({ sessionId, reason: 'session not found' })
        else if (!sameEntries(expected, live))
          skipped.push({ sessionId, reason: 'entries changed since the export' })
        else {
          await archiveBlackboardSession({
            sessionId,
            env: context.env,
            dependencies: context.dependencies,
          })
          archived.push(sessionId)
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        skipped.push({ sessionId, reason: `failed: ${reason}`.slice(0, MAX_REASON) })
      }
    }
  } catch (error) {
    throw new Error(
      `snapshot archive failed before any session was archived and the cleanupToken is still valid. ${(error as Error).message}`,
      { cause: error },
    )
  } finally {
    context.snapshots.restore(token, record)
  }
  return { sessionId: context.sessionId, archived, skipped }
}
