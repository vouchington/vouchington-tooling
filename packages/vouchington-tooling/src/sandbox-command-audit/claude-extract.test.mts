import { describe, expect, it } from 'vitest'
import { createClaudeRecordExtractor, extractClaudeRecords } from './claude-extract.mts'
import { classifyFailureText } from './failure-text.mts'
import { bashUse, jsonl, limits, toolResult } from './fixtures.test-helpers.mts'
import type { ClassifyFailure } from './types.mts'

const extract = (
  lines: string[],
  options: {
    classifyFailure?: ClassifyFailure | undefined
    overrides?: Parameters<typeof limits>[0]
  } = {},
) =>
  extractClaudeRecords(lines, {
    classifyFailure: options.classifyFailure,
    limits: limits(options.overrides),
  })

describe('claude escalations', () => {
  it('records a Bash call that asked to leave the sandbox, and nothing else', () => {
    const result = extract(
      jsonl(
        bashUse('1', 'pnpm install', { dangerouslyDisableSandbox: true }),
        bashUse('2', 'ls'),
        bashUse('3', 'rm', { dangerouslyDisableSandbox: false }),
        { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, null] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 7 }] } },
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'server_tool_use',
                id: '9',
                name: 'Read',
                input: { dangerouslyDisableSandbox: true },
              },
            ],
          },
        },
      ),
    )
    expect(result.escalations).toEqual([{ source: 'claude', command: 'pnpm install' }])
    expect(JSON.stringify(result)).not.toContain('rawRetention')
    expect(result.rawRetention.retainedRawBytes).toBeGreaterThan(0)
  })

  it('ignores blank lines, malformed JSON, non-objects and other record types', () => {
    const result = extract(['', '   ', '{bad', '7', 'null', JSON.stringify({ type: 'system' })])
    expect(result.escalations).toEqual([])
    expect(result.denials).toEqual([])
  })
})

describe('claude denials', () => {
  it('records each denial kind with its correlated command', () => {
    const result = extract(
      jsonl(
        bashUse('a', 'rm -rf /'),
        toolResult('a', 'no', { toolDenialKind: 'user-rejected' }),
        bashUse('b', 'gh pr merge'),
        toolResult('b', 'no', { toolDenialKind: 'permission-rule' }),
        bashUse('c', 'curl x'),
        toolResult('c', 'no', { toolDenialKind: 'automode-blocked' }),
      ),
    )
    expect(result.denials.map((record) => [record.kind, record.command])).toEqual([
      ['user-rejected', 'rm -rf /'],
      ['permission-rule', 'gh pr merge'],
      ['automode-blocked', 'curl x'],
    ])
  })

  it('ignores an unknown denial kind, non-errors, other tools and uncorrelated results', () => {
    const result = extract(
      jsonl(
        bashUse('a', 'echo'),
        toolResult('a', 'permission denied', { toolDenialKind: 'mystery' }),
        bashUse('b', 'echo'),
        toolResult('b', 'permission denied', { isError: false }),
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c', name: 'Read' }] } },
        toolResult('c', 'permission denied'),
        toolResult('missing', 'permission denied'),
        {
          type: 'user',
          message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_result' }] },
        },
      ),
    )
    expect(result.denials).toEqual([])
    expect(result.sandboxFailures.map((record) => record.command)).toEqual(['echo'])
  })
})

describe('claude sandbox failures', () => {
  const failed = (text: unknown, classifyFailure?: ClassifyFailure) =>
    extract(jsonl(bashUse('1', 'git status'), toolResult('1', text)), { classifyFailure })
      .sandboxFailures

  it('classifies E2BIG, permission signatures and loopback timeouts', () => {
    expect(failed('spawn E2BIG')).toMatchObject([{ kind: 'e2big', command: 'git status' }])
    expect(failed('Operation not permitted')).toMatchObject([{ kind: 'genuine' }])
    expect(failed([{ type: 'text', text: 'EACCES: denied' }])).toMatchObject([{ kind: 'genuine' }])
    expect(failed('connect ETIMEDOUT 127.0.0.1:5432')).toMatchObject([{ kind: 'genuine' }])
    expect(failed('connect ETIMEDOUT ::1:5432')).toMatchObject([{ kind: 'genuine' }])
    expect(failed('timed out reaching [::1]:8080')).toMatchObject([{ kind: 'genuine' }])
  })

  it('ignores ordinary failures and bare timeouts', () => {
    expect(failed('exit code 1')).toEqual([])
    expect(failed('request timed out')).toEqual([])
    expect(failed('timed out reaching 2001:db8::1')).toEqual([])
    expect(failed('connect ECONNREFUSED 127.0.0.1:5432')).toEqual([])
    expect(failed(undefined)).toEqual([])
  })

  it('lets an injected rule claim a failure before the generic signatures', () => {
    const rule: ClassifyFailure = (command, text, source) =>
      /read-only/.test(text) ? `write-path:${source}:${command}` : undefined
    expect(failed('read-only file system, permission denied', rule)).toMatchObject([
      { kind: 'write-path:claude:git status' },
    ])
    expect(failed('permission denied', rule)).toMatchObject([{ kind: 'genuine' }])
  })

  it('does not let an injected rule override E2BIG', () => {
    expect(failed('E2BIG', () => 'custom')).toMatchObject([{ kind: 'e2big' }])
  })

  it('truncates long error text and counts it', () => {
    const result = extract(
      jsonl(bashUse('1', 'ls'), toolResult('1', 'permission denied '.repeat(5))),
      {
        overrides: { maxRetainedRawTextChars: 10 },
      },
    )
    expect(result.sandboxFailures[0]!.errorText).toBe('permission… [truncated]')
    expect(result.rawRetention.errorTextsTruncated).toBe(1)
  })
})

describe('pending tool use bounds', () => {
  it('evicts the oldest pending call when the count cap is reached', () => {
    const result = extract(
      jsonl(
        bashUse('1', 'one'),
        bashUse('2', 'two'),
        toolResult('1', 'permission denied'),
        toolResult('2', 'permission denied'),
      ),
      { overrides: { maxPendingToolUses: 1 } },
    )
    expect(result.sandboxFailures.map((record) => record.command)).toEqual(['two'])
    expect(result.rawRetention.pendingToolUsesDropped).toBe(1)
  })

  it('evicts by combined size', () => {
    const result = extract(
      jsonl(
        bashUse('1', 'aaaa'),
        bashUse('2', 'bbbb'),
        bashUse('3', 'cccc'),
        toolResult('1', 'permission denied'),
        toolResult('3', 'permission denied'),
      ),
      { overrides: { maxPendingToolUseBytes: 20 } },
    )
    expect(result.sandboxFailures.map((record) => record.command)).toEqual(['cccc'])
    expect(result.rawRetention.pendingToolUsesDropped).toBe(1)
    expect(result.rawRetention.pendingToolUseBytesDropped).toBe(9)
  })

  it('drops a block too large to hold, still recording its escalation', () => {
    const result = extract(
      jsonl(
        bashUse('2', 'x'.repeat(40), { dangerouslyDisableSandbox: true }),
        toolResult('2', 'permission denied'),
      ),
      { overrides: { maxPendingToolUseBytes: 30 } },
    )
    expect(result.escalations).toHaveLength(1)
    expect(result.sandboxFailures).toEqual([])
    expect(result.rawRetention.pendingToolUsesDropped).toBe(1)
    expect(result.rawRetention.pendingToolUseBytesDropped).toBe(45)
  })

  it('stops evicting once nothing is pending, even with a zero cap', () => {
    const result = extract(jsonl(bashUse('1', 'one'), toolResult('1', 'permission denied')), {
      overrides: { maxPendingToolUses: 0 },
    })
    expect(result.sandboxFailures.map((record) => record.command)).toEqual(['one'])
  })

  it('replaces a tool_use that reuses an id', () => {
    const result = extract(
      jsonl(bashUse('1', 'first'), bashUse('1', 'second'), toolResult('1', 'permission denied')),
    )
    expect(result.sandboxFailures.map((record) => record.command)).toEqual(['second'])
  })

  it('truncates a retained command and counts it', () => {
    const result = extract(jsonl(bashUse('1', 'abcdefghij', { dangerouslyDisableSandbox: true })), {
      overrides: { maxRetainedRawTextChars: 4 },
    })
    expect(result.escalations[0]!.command).toBe('abcd… [truncated]')
    expect(result.rawRetention.commandTextsTruncated).toBe(1)
  })

  it('caps retained records and reports the drop', () => {
    const result = extract(
      jsonl(
        bashUse('1', 'a', { dangerouslyDisableSandbox: true }),
        bashUse('2', 'b', { dangerouslyDisableSandbox: true }),
      ),
      { overrides: { maxRetainedRecords: 1 } },
    )
    expect(result.escalations).toHaveLength(1)
    expect(result.rawRetention.recordsDropped).toBe(1)
  })
})

describe('streaming', () => {
  it('matches the batch helper and tolerates a partial final line', () => {
    const lines = [
      ...jsonl(bashUse('1', 'ls', { dangerouslyDisableSandbox: true })),
      '{"type":"assis',
    ]
    const extractor = createClaudeRecordExtractor({ limits: limits() })
    for (const line of lines) extractor.pushLine(line)
    expect(extractor.result().escalations).toEqual(extract(lines).escalations)
  })
})

describe('classifyFailureText', () => {
  it('returns undefined for text with no signature, with or without a rule', () => {
    expect(classifyFailureText('ls', 'fine', 'codex')).toBeUndefined()
    expect(classifyFailureText('ls', 'fine', 'codex', () => undefined)).toBeUndefined()
  })
})
