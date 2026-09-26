import {
  asRecord,
  emptyFacts,
  parseLines,
  type CodexSegment,
  type TokenTotals,
  type TranscriptFacts,
} from './shared.mts'
import { applyRecords } from './codex-records.mts'

export function codexChildren(
  lines: string[],
  ownerPath = '/root',
): Array<{ threadId: string; agentPath: string }> {
  const direct = new Map<string, string>()
  const base = ownerPath.replace(/\/$/, '')
  for (const record of parseLines(lines)) {
    const payload = asRecord(record.payload)
    if (record.type !== 'event_msg' || payload?.type !== 'sub_agent_activity') continue
    const threadId = payload.agent_thread_id
    const agentPath = payload.agent_path
    if (typeof threadId !== 'string' || typeof agentPath !== 'string') continue
    const normalized = agentPath.replace(/\/$/, '')
    if (normalized.startsWith(`${base}/`) && !normalized.slice(base.length + 1).includes('/'))
      direct.set(threadId, normalized)
  }
  return [...direct].map(([threadId, agentPath]) => ({ threadId, agentPath }))
}

export function codexIdentity(lines: string[]): { threadId?: string; agentPath: string } {
  const payload = asRecord(parseLines(lines.filter(Boolean).slice(0, 1))[0]?.payload)
  return {
    ...(typeof payload?.id === 'string' ? { threadId: payload.id } : {}),
    agentPath: typeof payload?.agent_path === 'string' ? payload.agent_path : '/root',
  }
}

export function computeCodex(
  lines: string[],
  subagents: CodexSegment[] = [],
  baseline?: TokenTotals,
): TranscriptFacts {
  const facts = emptyFacts()
  applyRecords(parseLines(lines), facts, false, baseline)
  for (const subagent of subagents)
    applyRecords(parseLines(subagent.lines), facts, true, subagent.baseline)
  return facts
}
