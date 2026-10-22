import { asRecord } from '../retrospective-transcript/index.mts'

/** Caps that keep a scan bounded. Every field can be overridden through `resolveLimits`. */
export type AuditLimits = {
  /** Claude tool_use blocks held while waiting for their tool_result. */
  maxPendingToolUses: number
  /** Combined size of those pending tool_use blocks. */
  maxPendingToolUseBytes: number
  /** Characters kept of one command or error text before it is truncated. */
  maxRetainedRawTextChars: number
  /** Records kept per result bucket. */
  maxRetainedRecords: number
  /** Combined JSON size of every retained record. */
  maxRetainedRawBytes: number
  /** Bytes spooled while a forked Codex child replays inherited history. */
  maxInheritedCodexSpoolBytes: number
}

export const DEFAULT_LIMITS: AuditLimits = {
  maxPendingToolUses: 10_000,
  maxPendingToolUseBytes: 2 * 1024 * 1024,
  maxRetainedRawTextChars: 64 * 1024,
  maxRetainedRecords: 10_000,
  maxRetainedRawBytes: 2 * 1024 * 1024,
  maxInheritedCodexSpoolBytes: 512 * 1024 * 1024,
}

export type RawRetention = {
  commandTextsTruncated: number
  errorTextsTruncated: number
  pendingToolUsesDropped: number
  pendingToolUseBytesDropped: number
  recordsDropped: number
  rawBytesDropped: number
  retainedRawBytes: number
}

export function resolveLimits(overrides: Partial<AuditLimits> = {}): AuditLimits {
  return { ...DEFAULT_LIMITS, ...overrides }
}

export function emptyRawRetention(): RawRetention {
  return {
    commandTextsTruncated: 0,
    errorTextsTruncated: 0,
    pendingToolUsesDropped: 0,
    pendingToolUseBytesDropped: 0,
    recordsDropped: 0,
    rawBytesDropped: 0,
    retainedRawBytes: 0,
  }
}

export function truncateRawText(
  text: string,
  retention: RawRetention,
  kind: 'command' | 'error',
  limits: AuditLimits,
): string {
  if (text.length <= limits.maxRetainedRawTextChars) return text
  if (kind === 'command') retention.commandTextsTruncated++
  else retention.errorTextsTruncated++
  return `${text.slice(0, limits.maxRetainedRawTextChars)}… [truncated]`
}

export function appendBounded<T>(
  records: T[],
  record: T,
  retention: RawRetention,
  limits: AuditLimits,
): void {
  const bytes = Buffer.byteLength(JSON.stringify(record))
  if (
    records.length >= limits.maxRetainedRecords ||
    retention.retainedRawBytes + bytes > limits.maxRetainedRawBytes
  ) {
    retention.recordsDropped++
    retention.rawBytesDropped += bytes
    return
  }
  records.push(record)
  retention.retainedRawBytes += bytes
}

export function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const [index, block] of content.entries()) {
    const record = asRecord(block)
    const next = record?.type === 'text' && typeof record.text === 'string' ? record.text : ''
    text += `${index > 0 ? '\n' : ''}${next}`
  }
  return text
}
