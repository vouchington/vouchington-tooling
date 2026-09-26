import {
  applyCommand,
  asNumber,
  asRecord,
  type ParsedLine,
  type TranscriptFacts,
} from './shared.mts'

export function applyAssistantUsage(
  record: ParsedLine,
  message: ParsedLine | undefined,
  subagent: boolean,
  facts: TranscriptFacts,
): void {
  if (record.type === 'assistant') {
    if (!subagent) facts.assistantResponses++
    const usage = asRecord(message?.usage)
    const totals = subagent ? facts.subagentTokens : facts.tokens
    totals.input += asNumber(usage?.input_tokens)
    totals.output += asNumber(usage?.output_tokens)
    totals.cacheRead += asNumber(usage?.cache_read_input_tokens)
    totals.cacheCreation += asNumber(usage?.cache_creation_input_tokens)
  }
}

export function applyToolBlocks(
  message: ParsedLine | undefined,
  subagent: boolean,
  facts: TranscriptFacts,
  advisorIds: Set<string>,
): void {
  const blocks = Array.isArray(message?.content) ? message.content : []
  for (const block of blocks) {
    const value = asRecord(block)
    if (!value) continue
    if (value.type === 'tool_use' || value.type === 'server_tool_use') {
      facts.toolCalls++
      if (subagent) facts.subagentToolCalls++
      if (value.name === 'advisor' && typeof value.id === 'string') advisorIds.add(value.id)
      if (value.name === 'Bash' || value.name === 'bash') {
        const command = asRecord(value.input)?.command
        if (typeof command === 'string') applyCommand(command, facts)
      }
    } else if (
      (value.type === 'tool_result' && value.is_error === true) ||
      (typeof value.type === 'string' && value.type.endsWith('_tool_result_error'))
    )
      facts.failedToolCalls++
    else if (value.type === 'advisor_tool_result' && typeof value.tool_use_id === 'string')
      advisorIds.add(value.tool_use_id)
  }
}
