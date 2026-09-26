import { CodexMessageCounter } from './codex-messages.mts'
import { commands, hasFailedOutcome } from './codex-payload.mts'
import {
  applyCommand,
  asNumber,
  asRecord,
  emptyTokens,
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

function isCall(payload: Record<string, unknown>): boolean {
  return (
    ['function_call', 'custom_tool_call'].includes(String(payload.type)) ||
    (typeof payload.type === 'string' && payload.type.endsWith('_call'))
  )
}

function isCallOutcome(payload: Record<string, unknown>): boolean {
  return typeof payload.type === 'string' && payload.type.endsWith('_call_output')
}

function addDelta(current: TokenTotals, previous: TokenTotals, target: TokenTotals): TokenTotals {
  target.input += Math.max(0, current.input - previous.input)
  target.output += Math.max(0, current.output - previous.output)
  target.cacheRead += Math.max(0, current.cacheRead - previous.cacheRead)
  return {
    input: Math.max(current.input, previous.input),
    output: Math.max(current.output, previous.output),
    cacheRead: Math.max(current.cacheRead, previous.cacheRead),
    cacheCreation: 0,
  }
}

export function applyRecords(
  records: ParsedLine[],
  facts: TranscriptFacts,
  subagent: boolean,
  baseline = emptyTokens(),
): void {
  let previous = baseline
  const calls = new Set<string>()
  const failed = new Set<string>()
  const messages = new CodexMessageCounter()
  let anonymousFailures = 0
  let previousCompaction: 'top-level' | 'context-event' | undefined
  for (const record of records) {
    const payload = asRecord(record.payload)
    if (!subagent) messages.add(record, payload)
    const compaction =
      record.type === 'compacted'
        ? 'top-level'
        : record.type === 'event_msg' && payload?.type === 'context_compacted'
          ? 'context-event'
          : undefined
    if (compaction && previousCompaction !== undefined && previousCompaction !== compaction)
      previousCompaction = undefined
    else if (compaction) {
      facts.compactions++
      previousCompaction = compaction
    } else previousCompaction = undefined
    const totals = usage(record)
    if (totals) {
      previous = addDelta(totals, previous, subagent ? facts.subagentTokens : facts.tokens)
    }
    if (record.type !== 'response_item' || !payload) continue
    const id =
      typeof payload.call_id === 'string'
        ? payload.call_id
        : typeof payload.id === 'string'
          ? payload.id
          : undefined
    if (isCall(payload)) {
      if (!id || !calls.has(id)) {
        facts.toolCalls++
        if (subagent) facts.subagentToolCalls++
        if (id) calls.add(id)
        if (payload.name === 'advisor') facts.advisorCalls++
        for (const rawCommand of commands(payload)) applyCommand(rawCommand, facts)
      }
    }
    if ((isCall(payload) || isCallOutcome(payload)) && hasFailedOutcome(payload)) {
      if (id) failed.add(id)
      else anonymousFailures++
    }
  }
  if (!subagent) {
    const [userPrompts, assistantResponses] = messages.totals()
    facts.userPrompts += userPrompts
    facts.assistantResponses += assistantResponses
  }
  facts.failedToolCalls += [...failed].filter((id) => calls.has(id)).length + anonymousFailures
}
