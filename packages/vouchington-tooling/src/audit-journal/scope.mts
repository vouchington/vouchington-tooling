import type { JournalEntry } from './types.mts'

/** A retrospective already saved in the session, with the blackboard's creation time for it. */
export type SavedRetrospective = { sourceEventId: string; createdAt: string }

export type JournalScope = {
  included: JournalEntry[]
  excluded: JournalEntry[]
  /** The retrospective whose time bounds the scope; absent when every entry is in scope. */
  boundary?: SavedRetrospective
}

const AUDIT_BLOCK =
  /^- `(?:recurring|one-off|sandbox-escalation|sandbox-failure|ambiguous-failure)`/m

function createdAtOf(entry: JournalEntry): string | undefined {
  return typeof entry.createdAt === 'string' ? entry.createdAt : undefined
}

function hasAuditBlock(entry: JournalEntry): boolean {
  const markdown = entry.data?.markdown
  return typeof markdown === 'string' && AUDIT_BLOCK.test(markdown)
}

function newest<T>(items: T[], at: (item: T) => string | undefined): T | undefined {
  let best: T | undefined
  for (const item of items) {
    const time = at(item)
    if (time !== undefined && (best === undefined || time > at(best)!)) best = item
  }
  return best
}

/** The newest saved retrospective created before `at`. */
function newestBefore(
  retrospectives: SavedRetrospective[],
  at: string | undefined,
): SavedRetrospective | undefined {
  if (at === undefined) return undefined
  return newest(
    retrospectives.filter((retrospective) => retrospective.createdAt < at),
    (retrospective) => retrospective.createdAt,
  )
}

/**
 * The retrospective that bounds work reported by an earlier one: the newest saved retrospective
 * created before the newest journal entry, by the same rule as `scopeSinceRetrospective` but
 * anchored on any entry rather than only on audit blocks.
 */
export function retrospectiveBoundary(
  entries: JournalEntry[],
  retrospectives: SavedRetrospective[],
): SavedRetrospective | undefined {
  const latest = newest(entries, createdAtOf)
  return newestBefore(retrospectives, latest && createdAtOf(latest))
}

/**
 * Keeps only the entries created after the boundary retrospective, so a later retrospective does
 * not repeat what an earlier one already reported.
 *
 * The boundary is the newest saved retrospective created before the newest entry that holds an
 * audit block. A new composition therefore starts after the latest retrospective (it is older than
 * the newest block), while a revision of the latest retrospective, which has no block after it,
 * falls back to the retrospective before it and so keeps its own blocks. The rule cannot tell a
 * revision from a new retrospective with no new blocks: both repeat the blocks since the one
 * before. Entries without a usable `createdAt` are never excluded, because nothing shows they are
 * older. With no earlier retrospective, or no block, nothing is excluded.
 */
export function scopeSinceRetrospective(
  entries: JournalEntry[],
  retrospectives: SavedRetrospective[],
): JournalScope {
  const newestBlock = newest(entries.filter(hasAuditBlock), createdAtOf)
  const blockAt = newestBlock === undefined ? undefined : createdAtOf(newestBlock)
  const boundary = newestBefore(retrospectives, blockAt)
  if (boundary === undefined) return { included: entries, excluded: [] }
  const isLater = (entry: JournalEntry) => {
    const at = createdAtOf(entry)
    return at === undefined || at > boundary.createdAt
  }
  return {
    included: entries.filter(isLater),
    excluded: entries.filter((entry) => !isLater(entry)),
    boundary,
  }
}
