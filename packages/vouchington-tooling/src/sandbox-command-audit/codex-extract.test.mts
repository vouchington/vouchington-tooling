import { describe, expect, it } from 'vitest'
import { createCodexRecordExtractor, extractCodexRecords } from './codex-extract.mts'
import { jsonl, limits } from './fixtures.test-helpers.mts'
import type { ClassifyFailure } from './types.mts'

const claimAll: ClassifyFailure = (command, text, source) => `${source}:${command}:${text}`

function completed(item: Record<string, unknown>) {
  return {
    type: 'event_msg',
    payload: { type: 'item_completed', item: { type: 'CommandExecution', ...item } },
  }
}

const extract = (
  lines: string[],
  classifyFailure: ClassifyFailure | undefined = claimAll,
  overrides = {},
) => extractCodexRecords(lines, { classifyFailure, limits: limits(overrides) })

describe('codex extraction', () => {
  it('records nothing without an injected rule', () => {
    const lines = jsonl(completed({ command: 'ls', aggregated_output: 'x' }))
    const result = extractCodexRecords(lines, { limits: limits() })
    expect(result.sandboxFailures).toEqual([])
  })

  it('reads a string command and aggregated output', () => {
    const result = extract(jsonl(completed({ command: 'ls', aggregated_output: 'out' })))
    expect(result.sandboxFailures).toEqual([
      { source: 'codex', kind: 'codex:ls:out', command: 'ls', errorText: 'out' },
    ])
    expect(Object.keys(result)).toEqual(['sandboxFailures'])
  })

  it('takes the last string of an argv command and joins stdout and stderr', () => {
    const result = extract(
      jsonl(
        completed({
          command: ['bash', 5, '-lc', 'make'],
          aggregated_output: '',
          stdout: 'a',
          stderr: 'b',
        }),
      ),
    )
    expect(result.sandboxFailures[0]).toMatchObject({ command: 'make', errorText: 'a\nb' })
  })

  it('falls back to parsed_cmd, skipping entries without a command', () => {
    const result = extract(jsonl(completed({ parsed_cmd: [null, { cmd: 'npm test' }] })))
    expect(result.sandboxFailures[0]).toMatchObject({ command: 'npm test', errorText: '' })
  })

  it('leaves the command unset when none can be found', () => {
    for (const item of [{ command: 7 }, { command: [1, 2] }, { parsed_cmd: [{ cmd: 3 }] }, {}]) {
      const record = extract(jsonl(completed(item))).sandboxFailures[0]!
      expect(record.command).toBeUndefined()
    }
  })

  it('records only the kind the rule returns', () => {
    const only: ClassifyFailure = (command) => (command === 'bad' ? 'denied' : undefined)
    const result = extract(jsonl(completed({ command: 'ok' }), completed({ command: 'bad' })), only)
    expect(result.sandboxFailures.map((record) => record.kind)).toEqual(['denied'])
  })

  it('ignores other events, other items, blank and malformed lines', () => {
    const result = extract([
      '',
      '{bad',
      ...jsonl(
        { type: 'response_item', payload: { type: 'item_completed' } },
        { type: 'event_msg', payload: { type: 'task_started' } },
        { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'Reasoning' } } },
        { type: 'event_msg', payload: { type: 'item_completed' } },
      ),
    ])
    expect(result.sandboxFailures).toEqual([])
  })

  it('truncates long command and error text', () => {
    const result = extract(
      jsonl(completed({ command: 'abcdef', aggregated_output: 'ghijkl' })),
      claimAll,
      {
        maxRetainedRawTextChars: 3,
      },
    )
    expect(result.rawRetention).toMatchObject({ commandTextsTruncated: 1, errorTextsTruncated: 1 })
  })

  it('keeps raw retention off the enumerable result', () => {
    const extractor = createCodexRecordExtractor({ classifyFailure: claimAll, limits: limits() })
    extractor.pushLine(JSON.stringify(completed({ command: 'ls' })))
    const result = extractor.result()
    expect(JSON.stringify(result)).not.toContain('rawRetention')
    expect(result.rawRetention.retainedRawBytes).toBeGreaterThan(0)
  })
})
