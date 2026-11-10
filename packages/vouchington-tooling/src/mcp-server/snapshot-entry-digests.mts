import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { canonicalFeedback } from '../agent-blackboard/feedback-canonical.mts'
import { parseSnapshotRecord } from '../agent-blackboard/snapshot-partition-format.mts'
import { isObject } from '../agent-blackboard/snapshot-partition-guards.mts'
import { readLines } from '../agent-blackboard/snapshot-partition-io.mts'
import type { SnapshotChecksum } from '../agent-blackboard/snapshot-types.mts'

/**
 * The identity of one entry: its content without the server-assigned `timestamp`, so entries that
 * differ only in it are one event. Hashed, so a comparison holds digests, never entry content.
 */
export function entryDigest(data: unknown): string {
  const content = isObject(data)
    ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'timestamp'))
    : data
  return createHash('sha256').update(canonicalFeedback(content)).digest('hex')
}

/**
 * Reads the snapshot once and returns, for each requested session present in it, the set of its
 * entries' digests. The file is read through a no-follow descriptor and, when the export reported
 * a checksum, verified against it, so a file replaced since the export is refused.
 */
export async function readExportedDigests(
  path: string,
  wanted: ReadonlySet<string>,
  checksum: SnapshotChecksum | undefined,
): Promise<Map<string, Set<string>>> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  const digests = new Map<string, Set<string>>()
  const hash = createHash('sha256')
  try {
    if (!(await file.stat()).isFile()) throw new Error('snapshot path is not a regular file')
    for await (const line of readLines(file, hash)) {
      const record = parseSnapshotRecord(line)
      if (record.type === 'session') {
        const id = record.session.id as string
        if (wanted.has(id)) digests.set(id, new Set())
      } else if (record.type === 'entry') {
        digests.get(record.entry.sessionId as string)?.add(entryDigest(record.entry.data))
      }
    }
  } finally {
    await file.close()
  }
  if (checksum !== undefined && hash.digest('hex') !== checksum.value)
    throw new Error('snapshot checksum does not match the export')
  return digests
}
