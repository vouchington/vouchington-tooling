import {
  asRecord,
  emptyTokens,
  parseLines,
  type CodexSegment,
  type ParsedLine,
  type TokenTotals,
} from './shared.mts'

function hasInheritedParent(sessionMeta: ParsedLine): boolean {
  const payload = asRecord(sessionMeta.payload)
  return (
    asRecord(asRecord(payload?.source)?.subagent) !== undefined ||
    typeof payload?.forked_from_id === 'string' ||
    typeof payload?.parent_thread_id === 'string' ||
    (typeof payload?.id === 'string' &&
      typeof payload.session_id === 'string' &&
      payload.id !== payload.session_id)
  )
}

function taskStartedSeconds(record: ParsedLine): number | undefined {
  if (record.type !== 'event_msg') return undefined
  const payload = asRecord(record.payload)
  if (payload?.type !== 'task_started' || typeof payload.started_at !== 'number') return undefined
  return payload.started_at >= 1_000_000_000_000 ? payload.started_at / 1000 : payload.started_at
}

function usage(record: ParsedLine): TokenTotals | undefined {
  const payload = asRecord(record.payload)
  const totals = asRecord(asRecord(payload?.info)?.total_token_usage)
  if (record.type !== 'event_msg' || payload?.type !== 'token_count' || !totals) return undefined
  const number = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  return {
    input: number(totals.input_tokens),
    output: number(totals.output_tokens),
    cacheRead: number(totals.cached_input_tokens),
    cacheCreation: 0,
  }
}

export function segmentCodex(lines: string[]): CodexSegment | undefined {
  const content = lines.filter(Boolean)
  const sessionMeta = parseLines(content.slice(0, 1))[0]
  if (sessionMeta?.type !== 'session_meta') return { lines: content, baseline: emptyTokens() }
  if (!hasInheritedParent(sessionMeta)) return { lines: content.slice(1), baseline: emptyTokens() }
  const timestamp = asRecord(sessionMeta.payload)?.timestamp
  const timestampMs = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN
  if (!Number.isFinite(timestampMs)) return undefined
  const sessionSeconds = Math.floor(timestampMs / 1000)
  const ownedIndex = content.findIndex((line, index) => {
    if (index === 0) return false
    const record = parseLines([line])[0]
    const startedAt = record ? taskStartedSeconds(record) : undefined
    return startedAt !== undefined && startedAt >= sessionSeconds
  })
  if (ownedIndex === -1) return undefined
  let baseline = emptyTokens()
  for (const record of parseLines(content.slice(1, ownedIndex)))
    baseline = usage(record) ?? baseline
  return { lines: content.slice(ownedIndex), baseline }
}
