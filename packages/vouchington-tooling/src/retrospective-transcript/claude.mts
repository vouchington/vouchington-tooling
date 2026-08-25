import {
  applyCommand,
  asNumber,
  asRecord,
  emptyFacts,
  parseLines,
  type TranscriptFacts,
} from './shared.mts'

function hasPromptContent(content: unknown): boolean {
  if (typeof content === 'string') return true
  if (!Array.isArray(content)) return false
  return content.some((block) => {
    const value = asRecord(block)
    return (
      value !== undefined && value.type !== 'tool_result' && value.type !== 'advisor_tool_result'
    )
  })
}

export function computeClaude(lines: string[][]): TranscriptFacts {
  const facts = emptyFacts()
  const seen = new Set<string>()
  const advisorIds = new Set<string>()
  for (const group of lines) {
    for (const record of parseLines(group)) {
      if (typeof record.uuid === 'string' && (seen.has(record.uuid) || !seen.add(record.uuid)))
        continue
      const subagent = record.isSidechain === true
      const message = asRecord(record.message)
      if (!subagent && record.type === 'user' && record.isCompactSummary === true)
        facts.compactions++
      if (
        !subagent &&
        record.type === 'user' &&
        hasPromptContent(message?.content) &&
        record.isMeta !== true &&
        record.isCompactSummary !== true
      )
        facts.userPrompts++
      if (record.type === 'assistant') {
        if (!subagent) facts.assistantResponses++
        const usage = asRecord(message?.usage)
        const totals = subagent ? facts.subagentTokens : facts.tokens
        totals.input += asNumber(usage?.input_tokens)
        totals.output += asNumber(usage?.output_tokens)
        totals.cacheRead += asNumber(usage?.cache_read_input_tokens)
        totals.cacheCreation += asNumber(usage?.cache_creation_input_tokens)
      }
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
        } else if (value.type === 'tool_result' && value.is_error === true) facts.failedToolCalls++
        else if (value.type === 'advisor_tool_result' && typeof value.tool_use_id === 'string')
          advisorIds.add(value.tool_use_id)
      }
    }
  }
  facts.advisorCalls = advisorIds.size
  return facts
}
