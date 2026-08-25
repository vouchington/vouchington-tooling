import {
  applyCommand,
  asNumber,
  asRecord,
  emptyFacts,
  emptyTokens,
  parseLines,
  type CodexSegment,
  type ParsedLine,
  type TokenTotals,
  type TranscriptFacts,
} from './shared.mts'

function usage(record: ParsedLine): TokenTotals | undefined {
  const payload = asRecord(record.payload)
  const totals = asRecord(asRecord(payload?.info)?.total_token_usage)
  if (record.type !== 'event_msg' || payload?.type !== 'token_count' || !totals) return undefined
  return {
    input: asNumber(totals.input_tokens),
    output: asNumber(totals.output_tokens),
    cacheRead: asNumber(totals.cached_input_tokens),
    cacheCreation: 0,
  }
}

function command(payload: Record<string, unknown>): string | undefined {
  if (!['exec_command', 'bash', 'shell', 'Bash'].includes(String(payload.name))) return undefined
  const raw = payload.type === 'function_call' ? payload.arguments : payload.input
  if (typeof raw !== 'string') return undefined
  try {
    const value = asRecord(JSON.parse(raw))
    const candidate = value?.cmd ?? value?.command
    return typeof candidate === 'string' ? candidate : undefined
  } catch {
    return undefined
  }
}

function callId(payload: Record<string, unknown>): string | undefined {
  return typeof payload.call_id === 'string'
    ? payload.call_id
    : typeof payload.id === 'string'
      ? payload.id
      : undefined
}

function hasFailedOutcome(payload: Record<string, unknown>): boolean {
  if (payload.status === 'failed' || payload.status === 'error' || payload.is_error === true)
    return true
  if (
    (typeof payload.exit_code === 'number' && payload.exit_code !== 0) ||
    (typeof payload.exitCode === 'number' && payload.exitCode !== 0) ||
    payload.success === false
  )
    return true
  return [payload.output, payload.result, payload.metadata]
    .map(asRecord)
    .some((value) => value !== undefined && hasFailedOutcome(value))
}

function isCall(payload: Record<string, unknown>): boolean {
  return (
    payload.type === 'function_call' ||
    payload.type === 'custom_tool_call' ||
    (typeof payload.type === 'string' && payload.type.endsWith('_call'))
  )
}

function isCallOutcome(payload: Record<string, unknown>): boolean {
  return typeof payload.type === 'string' && payload.type.endsWith('_call_output')
}

function addDelta(current: TokenTotals, previous: TokenTotals, target: TokenTotals): void {
  target.input += Math.max(0, current.input - previous.input)
  target.output += Math.max(0, current.output - previous.output)
  target.cacheRead += Math.max(0, current.cacheRead - previous.cacheRead)
}

function applyRecords(
  records: ParsedLine[],
  facts: TranscriptFacts,
  subagent: boolean,
  baseline = emptyTokens(),
): void {
  let previous = baseline
  const calls = new Set<string>()
  const failed = new Set<string>()
  let anonymousFailures = 0
  for (const record of records) {
    const payload = asRecord(record.payload)
    if (!subagent && record.type === 'event_msg' && payload?.type === 'user_message')
      facts.userPrompts++
    if (!subagent && record.type === 'event_msg' && payload?.type === 'agent_message')
      facts.assistantResponses++
    if (
      record.type === 'compacted' ||
      (record.type === 'event_msg' && payload?.type === 'context_compacted')
    )
      facts.compactions++
    const totals = usage(record)
    if (totals) {
      addDelta(totals, previous, subagent ? facts.subagentTokens : facts.tokens)
      previous = totals
    }
    if (record.type !== 'response_item' || !payload) continue
    const id = callId(payload)
    if (isCall(payload)) {
      if (!id || !calls.has(id)) {
        facts.toolCalls++
        if (subagent) facts.subagentToolCalls++
        if (id) calls.add(id)
        const rawCommand = command(payload)
        if (rawCommand) applyCommand(rawCommand, facts)
      }
    }
    if ((isCall(payload) || isCallOutcome(payload)) && hasFailedOutcome(payload)) {
      if (id) failed.add(id)
      else anonymousFailures++
    }
  }
  facts.failedToolCalls += [...failed].filter((id) => calls.has(id)).length + anonymousFailures
}

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

export function withoutLeadingSessionMetadata(lines: string[]): string[] {
  const content = lines.filter(Boolean)
  return parseLines(content.slice(0, 1))[0]?.type === 'session_meta' ? content.slice(1) : content
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
