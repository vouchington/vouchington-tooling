import { asRecord } from '../retrospective-transcript/index.mts'
import { appendBounded, truncateRawText, type AuditLimits, type RawRetention } from './limits.mts'
import type { ClaudeEscalationRecord } from './types.mts'

export type ToolUseInfo = { name: string; command?: string | undefined; bytes: number }

function evict(
  toolUses: Map<string, ToolUseInfo>,
  bytes: number,
  retention: RawRetention,
  pendingBytes: { value: number },
  limits: AuditLimits,
): void {
  while (
    toolUses.size >= limits.maxPendingToolUses ||
    pendingBytes.value + bytes > limits.maxPendingToolUseBytes
  ) {
    const oldest = toolUses.keys().next().value
    if (oldest === undefined) break
    const evicted = toolUses.get(oldest)!
    toolUses.delete(oldest)
    pendingBytes.value -= evicted.bytes
    retention.pendingToolUsesDropped++
    retention.pendingToolUseBytesDropped += evicted.bytes
  }
}

/**
 * Remembers a Claude tool_use so its later tool_result can be correlated to the command, and
 * records an escalation when a Bash call asked to leave the sandbox. Pending state is bounded by
 * `limits`; a block too large to hold is dropped (its escalation is still recorded).
 */
export function recordClaudeToolUse(
  block: unknown,
  toolUses: Map<string, ToolUseInfo>,
  escalations: ClaudeEscalationRecord[],
  retention: RawRetention,
  pendingBytes: { value: number },
  limits: AuditLimits,
): void {
  const value = asRecord(block)
  if (!value || (value.type !== 'tool_use' && value.type !== 'server_tool_use')) return
  const id = typeof value.id === 'string' ? value.id : undefined
  const name = typeof value.name === 'string' ? value.name : undefined
  if (!id || !name) return
  const input = asRecord(value.input)
  const command = typeof input?.command === 'string' ? input.command : undefined
  const retainedCommand = command
    ? truncateRawText(command, retention, 'command', limits)
    : undefined
  const bytes =
    Buffer.byteLength(id) + Buffer.byteLength(name) + Buffer.byteLength(retainedCommand ?? '')
  const existing = toolUses.get(id)
  if (existing) {
    toolUses.delete(id)
    pendingBytes.value -= existing.bytes
  }
  const escalated = name === 'Bash' && command && input?.dangerouslyDisableSandbox === true
  if (bytes > limits.maxPendingToolUseBytes) {
    retention.pendingToolUsesDropped++
    retention.pendingToolUseBytesDropped += bytes
  } else {
    evict(toolUses, bytes, retention, pendingBytes, limits)
    toolUses.set(id, { name, command: retainedCommand, bytes })
    pendingBytes.value += bytes
  }
  if (escalated) {
    appendBounded(escalations, { source: 'claude', command: retainedCommand! }, retention, limits)
  }
}
