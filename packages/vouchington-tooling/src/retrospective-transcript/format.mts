import type { TranscriptFacts } from './shared.mts'

const LABEL_CHARACTER = /[^A-Za-z0-9._-]+/g

export function sessionLabel(value: string): string {
  return value.replace(/\s+/g, '_').replace(LABEL_CHARACTER, '_').slice(0, 128) || 'transcript'
}

export function formatTranscriptFacts(sessionId: string, facts: TranscriptFacts): string {
  return [
    '=== Transcript Facts ===',
    `Session: ${sessionLabel(sessionId)}`,
    `User prompts: ${facts.userPrompts}`,
    `Assistant responses: ${facts.assistantResponses}`,
    `Tool calls: ${facts.toolCalls} (failed: ${facts.failedToolCalls})`,
    `no-mistakes invocations: ${facts.noMistakesInvocations}`,
    `advisor calls: ${facts.advisorCalls}`,
    `Push commands attempted: ${facts.pushCommandAttempts}`,
    `Compactions: ${facts.compactions}`,
    `Tokens: input=${facts.tokens.input} output=${facts.tokens.output} cache_read=${facts.tokens.cacheRead} cache_creation=${facts.tokens.cacheCreation}`,
    `Subagent tool calls: ${facts.subagentToolCalls}`,
    `Subagent tokens: input=${facts.subagentTokens.input} output=${facts.subagentTokens.output} cache_read=${facts.subagentTokens.cacheRead} cache_creation=${facts.subagentTokens.cacheCreation}`,
    '',
  ].join('\n')
}

export const formatUnavailable = (reason: string): string =>
  `=== Transcript Facts ===\nStatus: unavailable (${reason.replace(/\s+/g, ' ').slice(0, 240)})\n`
