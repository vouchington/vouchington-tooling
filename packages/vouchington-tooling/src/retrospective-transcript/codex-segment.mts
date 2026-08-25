import {
  asNumber,
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
      payload.id.toLowerCase() !== payload.session_id.toLowerCase())
  )
}

function isOwnedTaskStart(record: ParsedLine, timestampMs: number): boolean {
  if (record.type !== 'event_msg') return false
  const payload = asRecord(record.payload)
  if (payload?.type !== 'task_started' || typeof payload.started_at !== 'number') return false
  return payload.started_at >= 1_000_000_000_000
    ? payload.started_at >= timestampMs
    : payload.started_at >= Math.floor(timestampMs / 1000)
}

function usage(record: ParsedLine): TokenTotals | undefined {
  if (record.type !== 'event_msg') return undefined
  const payload = asRecord(record.payload)
  if (payload?.type !== 'token_count') return undefined
  const totals = asRecord(asRecord(payload?.info)?.total_token_usage)
  if (!totals) return undefined
  return {
    input: asNumber(totals.input_tokens),
    output: asNumber(totals.output_tokens),
    cacheRead: asNumber(totals.cached_input_tokens),
    cacheCreation: 0,
  }
}

function retainHighWater(previous: TokenTotals, current: TokenTotals): TokenTotals {
  return {
    input: Math.max(previous.input, current.input),
    output: Math.max(previous.output, current.output),
    cacheRead: Math.max(previous.cacheRead, current.cacheRead),
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
  const ownedIndex = content.findIndex((line, index) => {
    if (index === 0) return false
    const record = parseLines([line])[0]
    return record ? isOwnedTaskStart(record, timestampMs) : false
  })
  if (ownedIndex === -1) return undefined
  let baseline: TokenTotals | undefined
  for (const record of parseLines(content.slice(1, ownedIndex))) {
    const current = usage(record)
    if (current) baseline = retainHighWater(baseline ?? emptyTokens(), current)
  }
  if (!baseline) return undefined
  return { lines: content.slice(ownedIndex), baseline }
}
