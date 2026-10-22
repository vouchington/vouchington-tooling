import { asArray, asRecord } from '../retrospective-transcript/index.mts'
import { recordClaudeToolUse, type ToolUseInfo } from './claude-tool-uses.mts'
import { classifyFailureText } from './failure-text.mts'
import { parseJsonRecord } from './json-record.mts'
import {
  appendBounded,
  emptyRawRetention,
  extractToolResultText,
  truncateRawText,
  type AuditLimits,
  type RawRetention,
} from './limits.mts'
import type {
  ClassifyFailure,
  ClaudeDenialRecord,
  ClaudeEscalationRecord,
  ClaudeSandboxFailureRecord,
  ClaudeToolDenialKind,
} from './types.mts'

const DENIAL_KINDS: string[] = ['user-rejected', 'permission-rule', 'automode-blocked']

function isDenialKind(value: unknown): value is ClaudeToolDenialKind {
  return typeof value === 'string' && DENIAL_KINDS.includes(value)
}

export type ClaudeExtraction = {
  escalations: ClaudeEscalationRecord[]
  denials: ClaudeDenialRecord[]
  sandboxFailures: ClaudeSandboxFailureRecord[]
  rawRetention: RawRetention
}

export type ClaudeRecordExtractor = {
  pushLine: (line: string) => void
  result: () => ClaudeExtraction
}

export type ClaudeExtractOptions = {
  classifyFailure?: ClassifyFailure | undefined
  limits: AuditLimits
}

type Pending = { toolUses: Map<string, ToolUseInfo>; bytes: { value: number } }

function recordToolResult(
  record: Record<string, unknown>,
  pending: Pending,
  out: ClaudeExtraction,
  options: ClaudeExtractOptions,
): void {
  const denialKind = isDenialKind(record.toolDenialKind) ? record.toolDenialKind : undefined
  for (const block of asArray(asRecord(record.message)?.content)) {
    const value = asRecord(block)
    if (!value || value.type !== 'tool_result') continue
    const toolUseId = typeof value.tool_use_id === 'string' ? value.tool_use_id : undefined
    const toolUse = toolUseId ? pending.toolUses.get(toolUseId) : undefined
    if (toolUseId && toolUse) {
      pending.toolUses.delete(toolUseId)
      pending.bytes.value -= toolUse.bytes
    }
    if (value.is_error !== true || toolUse?.name !== 'Bash') continue
    const { rawRetention, denials, sandboxFailures } = out
    if (denialKind) {
      const denial = { source: 'claude', kind: denialKind, command: toolUse.command } as const
      appendBounded(denials, denial, rawRetention, options.limits)
      continue
    }
    const text = extractToolResultText(value.content)
    const kind = classifyFailureText(toolUse.command, text, 'claude', options.classifyFailure)
    if (!kind) continue
    const errorText = truncateRawText(text, rawRetention, 'error', options.limits)
    const failure = { source: 'claude', kind, command: toolUse.command, errorText } as const
    appendBounded(sandboxFailures, failure, rawRetention, options.limits)
  }
}

/**
 * Streams Claude transcript lines into escalation, denial and sandbox-failure records. A
 * tool_use always precedes its tool_result in file order, so one forward pass correlates every
 * result with its command. A malformed or partially written line never hides earlier records.
 */
export function createClaudeRecordExtractor(options: ClaudeExtractOptions): ClaudeRecordExtractor {
  const rawRetention = emptyRawRetention()
  const out: ClaudeExtraction = { escalations: [], denials: [], sandboxFailures: [], rawRetention }
  const pending: Pending = { toolUses: new Map(), bytes: { value: 0 } }
  return {
    pushLine(line) {
      const record = parseJsonRecord(line)
      if (record?.type === 'assistant') {
        for (const block of asArray(asRecord(record.message)?.content)) {
          const { toolUses, bytes } = pending
          const { escalations } = out
          recordClaudeToolUse(block, toolUses, escalations, rawRetention, bytes, options.limits)
        }
      } else if (record?.type === 'user') {
        recordToolResult(record, pending, out, options)
      }
    },
    result: () => {
      const { escalations, denials, sandboxFailures } = out
      const result = { escalations, denials, sandboxFailures, rawRetention }
      // Keep the enumerable JSON contract stable; the scanner reads this accounting field directly.
      Object.defineProperty(result, 'rawRetention', { enumerable: false, value: rawRetention })
      return result
    },
  }
}

export function extractClaudeRecords(
  lines: string[],
  options: ClaudeExtractOptions,
): ClaudeExtraction {
  const extractor = createClaudeRecordExtractor(options)
  for (const line of lines) extractor.pushLine(line)
  return extractor.result()
}
