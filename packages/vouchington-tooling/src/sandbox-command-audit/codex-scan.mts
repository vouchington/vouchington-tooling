import { asRecord, openTranscriptLines } from '../retrospective-transcript/index.mts'
import {
  createCodexRecordExtractor,
  type CodexExtractOptions,
  type CodexExtraction,
} from './codex-extract.mts'
import { createSpool, type Spool } from './codex-spool.mts'

export type CodexFileResult = CodexExtraction | { error: string }

function inheritedSession(record: Record<string, unknown>): boolean {
  const payload = asRecord(record.payload)
  return (
    asRecord(asRecord(payload?.source)?.subagent) !== undefined ||
    typeof payload?.forked_from_id === 'string' ||
    typeof payload?.parent_thread_id === 'string' ||
    (typeof payload?.id === 'string' &&
      typeof payload.session_id === 'string' &&
      payload.id !== payload.session_id)
  )
}

// started_at is epoch seconds or milliseconds. A millisecond value is compared against the exact
// session creation time, so an inherited task from earlier in the same second is not mistaken for
// an owned one; a seconds value can only be compared at second precision.
function ownedTaskStarted(line: string, sessionMs: number): boolean {
  try {
    const record = asRecord(JSON.parse(line))
    const payload = asRecord(record?.payload)
    if (record?.type !== 'event_msg' || payload?.type !== 'task_started') return false
    if (typeof payload.started_at !== 'number') return false
    const inMillis = payload.started_at >= 1_000_000_000_000
    if (inMillis) return payload.started_at >= sessionMs
    return payload.started_at >= Math.floor(sessionMs / 1000)
  } catch {
    return false
  }
}

// The creation time of a forked child's session when its first record marks it inherited, else
// undefined (including for malformed metadata, which falls back to scanning the whole file).
function inheritedSessionMs(line: string): number | undefined {
  try {
    const record = asRecord(JSON.parse(line))
    if (record?.type !== 'session_meta' || !inheritedSession(record)) return undefined
    const timestamp = asRecord(record.payload)?.timestamp
    const timestampMs = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN
    return Number.isFinite(timestampMs) ? timestampMs : undefined
  } catch {
    return undefined
  }
}

/**
 * Extracts records from one Codex transcript. A forked child repeats its parent's history before
 * its first owned `task_started`; that prefix is spooled under `tempRoot` and dropped once the
 * owned task starts. When no owned task is ever found the whole spool is replayed, deliberately
 * over-counting rather than losing activity.
 */
export async function scanCodexFile(
  file: string,
  tempRoot: string,
  options: CodexExtractOptions,
): Promise<CodexFileResult> {
  const opened = await openTranscriptLines(file)
  if ('error' in opened) return { error: opened.error }
  const extractor = createCodexRecordExtractor(options)
  let spool: Spool | undefined
  let sessionMs: number | undefined
  let first = true
  try {
    for await (const line of opened.lines) {
      if (first && line.trim()) {
        first = false
        sessionMs = inheritedSessionMs(line)
        if (sessionMs !== undefined) {
          spool = await createSpool(tempRoot, options.limits.maxInheritedCodexSpoolBytes)
        }
      }
      if (spool === undefined || sessionMs === undefined) {
        extractor.pushLine(line)
        continue
      }
      await spool.write(line)
      if (!ownedTaskStarted(line, sessionMs)) continue
      await spool.discard()
      spool = undefined
      extractor.pushLine(line)
    }
    if (spool) {
      await spool.close()
      const replay = await openTranscriptLines(spool.path)
      if ('error' in replay) return { error: replay.error }
      for await (const line of replay.lines) extractor.pushLine(line)
    }
    return extractor.result()
  } catch (err) {
    return { error: (err as Error).message }
  } finally {
    await spool?.discard()
  }
}
