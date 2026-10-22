import { asRecord } from '../retrospective-transcript/index.mts'
import { parseJsonRecord } from './json-record.mts'
import {
  appendBounded,
  emptyRawRetention,
  truncateRawText,
  type AuditLimits,
  type RawRetention,
} from './limits.mts'
import type { ClassifyFailure, CodexSandboxFailureRecord } from './types.mts'

// A CommandExecution item carries `command` as a string or as an argv array such as
// `["bash", "-lc", "<script>"]`; the command text is the last string.
function commandFromArguments(command: unknown): string | undefined {
  if (typeof command === 'string') return command
  if (!Array.isArray(command)) return undefined
  return command.findLast((entry): entry is string => typeof entry === 'string')
}

function commandFromExecution(item: Record<string, unknown>): string | undefined {
  const direct = commandFromArguments(item.command)
  if (direct !== undefined || !Array.isArray(item.parsed_cmd)) return direct
  for (const parsed of item.parsed_cmd) {
    const record = asRecord(parsed)
    if (typeof record?.cmd === 'string') return record.cmd
  }
  return undefined
}

function outputFromExecution(item: Record<string, unknown>): string {
  if (typeof item.aggregated_output === 'string' && item.aggregated_output.length > 0) {
    return item.aggregated_output
  }
  return [item.stdout, item.stderr]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n')
}

export type CodexExtraction = {
  sandboxFailures: CodexSandboxFailureRecord[]
  rawRetention: RawRetention
}

export type CodexRecordExtractor = {
  pushLine: (line: string) => void
  result: () => CodexExtraction
}

export type CodexExtractOptions = {
  classifyFailure?: ClassifyFailure | undefined
  limits: AuditLimits
}

/**
 * Streams Codex transcript lines. Only completed CommandExecution items that the caller's
 * `classifyFailure` rule claims are recorded: the generic permission signatures are not applied to
 * Codex output.
 */
export function createCodexRecordExtractor(options: CodexExtractOptions): CodexRecordExtractor {
  const rawRetention = emptyRawRetention()
  const sandboxFailures: CodexSandboxFailureRecord[] = []
  const { classifyFailure, limits } = options
  return {
    pushLine(line) {
      if (!classifyFailure) return
      const record = parseJsonRecord(line)
      const payload = asRecord(record?.payload)
      const item = asRecord(payload?.item)
      if (record?.type !== 'event_msg' || payload?.type !== 'item_completed') return
      if (item?.type !== 'CommandExecution') return
      const command = commandFromExecution(item)
      const errorText = outputFromExecution(item)
      const kind = classifyFailure(command, errorText, 'codex')
      if (kind === undefined) return
      const failure = {
        source: 'codex',
        kind,
        command: command ? truncateRawText(command, rawRetention, 'command', limits) : undefined,
        errorText: truncateRawText(errorText, rawRetention, 'error', limits),
      } as const
      appendBounded(sandboxFailures, failure, rawRetention, limits)
    },
    result: () => {
      const result = { sandboxFailures, rawRetention }
      Object.defineProperty(result, 'rawRetention', { enumerable: false, value: rawRetention })
      return result
    },
  }
}

export function extractCodexRecords(
  lines: string[],
  options: CodexExtractOptions,
): CodexExtraction {
  const extractor = createCodexRecordExtractor(options)
  for (const line of lines) extractor.pushLine(line)
  return extractor.result()
}
