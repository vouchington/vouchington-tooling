import {
  asRecord,
  emptyFacts,
  parseLines,
  type CodexSegment,
  type TokenTotals,
  type TranscriptFacts,
} from './shared.mts'
import { advanceBaseline, applyRecords } from './codex-records.mts'
import { windowRecords, type TranscriptWindow } from './window.mts'

export function codexChildren(
  lines: string[],
  ownerPath = '/root',
): Array<{ threadId: string; agentPath: string }> {
  const direct = new Map<string, string>()
  const base = ownerPath.replace(/\/$/, '')
  for (const record of parseLines(lines)) {
    const payload = asRecord(record.payload)
    if (record.type !== 'event_msg') continue
    const activity =
      payload?.type === 'sub_agent_activity'
        ? payload
        : payload?.type === 'item_completed' && asRecord(payload.item)?.type === 'SubAgentActivity'
          ? asRecord(payload.item)
          : undefined
    const threadId = activity?.agent_thread_id
    const agentPath = activity?.agent_path
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
  window?: TranscriptWindow,
): TranscriptFacts {
  const facts = emptyFacts()
  let skipped = 0
  const apply = (segment: string[], subagent: boolean, start?: TokenTotals): void => {
    const { included, before, excluded } = windowRecords(parseLines(segment), window)
    skipped += excluded
    applyRecords(included, facts, subagent, advanceBaseline(before, start))
  }
  apply(lines, false, baseline)
  for (const subagent of subagents) apply(subagent.lines, true, subagent.baseline)
  if (window) facts.excludedEvents = skipped
  return facts
}
