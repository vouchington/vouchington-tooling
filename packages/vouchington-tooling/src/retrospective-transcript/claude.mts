import { asRecord, emptyFacts, parseLines, type TranscriptFacts } from './shared.mts'
import { applyAssistantUsage, applyToolBlocks } from './claude-blocks.mts'

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
      applyAssistantUsage(record, message, subagent, facts)
      applyToolBlocks(message, subagent, facts, advisorIds)
    }
  }
  facts.advisorCalls = advisorIds.size
  return facts
}
