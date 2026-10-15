import { readFile } from 'node:fs/promises'
import type { Session, SessionEntry } from './session-types.mts'

export type PartitionData = {
  sessions: Session[]
  entriesBySession: Map<string, SessionEntry[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Mirrors the record envelope the agent-blackboard client's own partition writer emits: one JSON
// object per line, discriminated by `type`. A partition file is written read-only only after its
// own terminal `manifest` line has already validated, so this reader trusts the bytes on disk — it
// does not re-verify partition integrity, only recognizes the shapes it can use. An unrecognized
// `type` (a future upstream record kind, or the top-level snapshot stream's own `error` record,
// which partition files never carry) is skipped rather than treated as fatal, so a
// forward-compatible upstream release can't break this classifier.
function parseLine(line: string): Record<string, unknown> {
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    throw new Error('partition contains a line that is not valid JSON')
  }
  if (!isRecord(record) || typeof record.type !== 'string') {
    throw new Error('partition contains a record with no string "type" field')
  }
  return record
}

export async function readPartitionRecords(path: string): Promise<PartitionData> {
  const raw = await readFile(path, 'utf8')
  const sessions: Session[] = []
  const entriesBySession = new Map<string, SessionEntry[]>()

  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const record = parseLine(line)

    if (record.type === 'session' && isRecord(record.session)) {
      sessions.push(record.session as unknown as Session)
      continue
    }
    if (record.type === 'entry' && isRecord(record.entry)) {
      const entry = record.entry as unknown as SessionEntry
      const existing = entriesBySession.get(entry.sessionId)
      if (existing) existing.push(entry)
      else entriesBySession.set(entry.sessionId, [entry])
    }
    // 'manifest' (the partition's own terminal line) and any other record type carry no
    // session-shape information for this classifier and are intentionally ignored.
  }

  return { sessions, entriesBySession }
}
