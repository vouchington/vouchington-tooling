import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  computeTranscriptFacts,
  formatTranscriptFacts,
  resolveTranscriptFile,
  runRetrospectiveTranscript,
} from './index.mts'
import { codexChildren, codexIdentity } from './codex.mts'
import { applyCommand, emptyFacts } from './shared.mts'

const claudeLines = [
  JSON.stringify({ type: 'user', message: { content: 'hello' } }),
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pnpm exec no-mistakes' } }],
      usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 4 },
    },
  }),
]

describe('retrospective transcript', () => {
  it('computes Claude facts and formats a stable report', () => {
    const facts = computeTranscriptFacts(claudeLines)
    expect(facts).toMatchObject({ userPrompts: 1, assistantResponses: 1, toolCalls: 1 })
    expect(facts.noMistakesInvocations).toBe(1)
    expect(formatTranscriptFacts('session', facts)).toBe(
      '=== Transcript Facts ===\nSession: session\nUser prompts: 1\nAssistant responses: 1\nTool calls: 1 (failed: 0)\nno-mistakes invocations: 1\nPush commands attempted: 0\nCompactions: 0\nTokens: input=2 output=3 cache_read=4 cache_creation=0\nSubagent tool calls: 0\nSubagent tokens: input=0 output=0 cache_read=0 cache_creation=0\n',
    )
  })

  it('counts only shell command positions', () => {
    const facts = computeTranscriptFacts([
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'echo no-mistakes; git -C x push' },
            },
          ],
        },
      }),
    ])
    expect(facts.noMistakesInvocations).toBe(0)
    expect(facts.pushCommandAttempts).toBe(1)
  })

  it('tolerates torn Claude input while excluding metadata and deduplicating records', () => {
    const duplicate = {
      uuid: 'same-message',
      type: 'assistant',
      message: {
        content: [
          {
            type: 'server_tool_use',
            name: 'bash',
            input: { command: 'NO=1 pnpm run no-mistakes' },
          },
          { type: 'tool_result', is_error: true },
        ],
        usage: {
          input_tokens: 5,
          output_tokens: 6,
          cache_read_input_tokens: 7,
          cache_creation_input_tokens: 8,
        },
      },
    }
    const facts = computeTranscriptFacts([
      JSON.stringify({ type: 'user', isMeta: true, message: { content: 'hidden' } }),
      JSON.stringify({ type: 'user', isCompactSummary: true, message: { content: 'summary' } }),
      JSON.stringify(duplicate),
      JSON.stringify(duplicate),
      JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git push' } }],
          usage: { input_tokens: 9, output_tokens: 10 },
        },
      }),
      '{',
    ])

    expect(facts).toMatchObject({
      userPrompts: 1,
      assistantResponses: 1,
      toolCalls: 2,
      failedToolCalls: 1,
      noMistakesInvocations: 1,
      pushCommandAttempts: 1,
      compactions: 1,
      tokens: { input: 5, output: 6, cacheRead: 7, cacheCreation: 8 },
      subagentToolCalls: 1,
      subagentTokens: { input: 9, output: 10 },
    })
  })

  it('counts supported Claude tools while ignoring malformed and unrelated content blocks', () => {
    const facts = computeTranscriptFacts([
      JSON.stringify({ type: 'user', message: { content: ['not a string'] } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: ['not an object', { type: 'tool_use', name: 'Read' }, { type: 'other' }],
        },
      }),
    ])

    expect(facts).toMatchObject({ userPrompts: 0, assistantResponses: 1, toolCalls: 1 })
  })

  it('derives Codex token deltas, command calls, failures, and compactions', () => {
    const facts = computeTranscriptFacts([
      JSON.stringify({ type: 'session_meta', payload: { id: 'root' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }),
      JSON.stringify({ type: 'compacted', payload: {} }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'context_compacted' } }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 10, output_tokens: 20, cached_input_tokens: 3 },
          },
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 8, output_tokens: 24, cached_input_tokens: 5 },
          },
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'failed-once',
          status: 'failed',
          name: 'exec_command',
          arguments: '{"cmd":"git -C project push"}',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', name: 'shell', arguments: '{' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'failed-once',
          is_error: true,
          name: 'bash',
          input: '{}',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          is_error: true,
          name: 'shell',
          input: '{"command":"pnpm exec no-mistakes"}',
        },
      }),
    ])

    expect(facts).toMatchObject({
      userPrompts: 1,
      assistantResponses: 1,
      toolCalls: 4,
      failedToolCalls: 2,
      noMistakesInvocations: 1,
      pushCommandAttempts: 1,
      compactions: 2,
      tokens: { input: 10, output: 24, cacheRead: 5, cacheCreation: 0 },
    })
  })

  it('accounts for segmented Codex children and rejects unsegmented child input', () => {
    const root = [JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } })]
    const child = [
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', name: 'Bash', arguments: '{"cmd":"git push"}' },
      }),
    ]

    expect(
      computeTranscriptFacts(root, [
        { lines: child, baseline: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } },
      ]),
    ).toMatchObject({ userPrompts: 1, toolCalls: 1, subagentToolCalls: 1, pushCommandAttempts: 1 })
    expect(() => computeTranscriptFacts(root, [child])).toThrow('Codex subagents must be segmented')
  })

  it('recognizes only direct Codex descendants and uses safe identity defaults', () => {
    const root = '11111111-1111-1111-1111-111111111111'
    const child = '22222222-2222-2222-2222-222222222222'
    const lines = [
      JSON.stringify({ type: 'session_meta', payload: { id: root, agent_path: '/root/' } }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'sub_agent_activity', agent_thread_id: child, agent_path: '/root/child/' },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'sub_agent_activity',
          agent_thread_id: 'ignored',
          agent_path: '/root/child/grandchild',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'sub_agent_activity', agent_path: '/root/no-id' },
      }),
    ]

    expect(codexIdentity(lines)).toEqual({ threadId: root, agentPath: '/root/' })
    expect(codexIdentity(['{'])).toEqual({ agentPath: '/root' })
    expect(codexChildren(lines)).toEqual([{ threadId: child, agentPath: '/root/child' }])
  })

  it('normalizes shell command separators, assignments, and quotes', () => {
    const facts = emptyFacts()
    applyCommand(
      "FLAG=yes npx no-mistakes && 'git' push | pnpm exec no-mistakes\ngit -c user.name=x push",
      facts,
    )
    expect(facts.noMistakesInvocations).toBe(2)
    expect(facts.pushCommandAttempts).toBe(2)
  })

  it('returns no facts for unsupported and mixed schemas', () => {
    expect(computeTranscriptFacts(['{', JSON.stringify({ type: 'other' })])).toEqual(emptyFacts())
    expect(
      computeTranscriptFacts([
        JSON.stringify({ type: 'user', message: { content: 'Claude' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
      ]),
    ).toEqual(emptyFacts())
  })

  it('reports a stable unavailable block when no session identity is supplied', async () => {
    await expect(runRetrospectiveTranscript({ env: {} })).resolves.toBe(
      '=== Transcript Facts ===\nStatus: unavailable (no session id (pass --session-id or set CODEX_THREAD_ID or CLAUDE_CODE_SESSION_ID))\n',
    )
  })

  it('resolves Codex transcripts and confines traversal to direct descendants', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-'))
    const root = '11111111-1111-1111-1111-111111111111'
    const child = '22222222-2222-2222-2222-222222222222'
    const sibling = '33333333-3333-3333-3333-333333333333'
    const rootPath = join(directory, `rollout-2026-${root}.jsonl`)
    const childPath = join(directory, `rollout-2026-${child}.jsonl`)
    const siblingPath = join(directory, `rollout-2026-${sibling}.jsonl`)
    await writeFile(
      rootPath,
      [
        JSON.stringify({ type: 'session_meta', payload: { id: root, agent_path: '/root' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'sub_agent_activity',
            agent_thread_id: child,
            agent_path: '/root/child',
          },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'sub_agent_activity',
            agent_thread_id: sibling,
            agent_path: '/other/sibling',
          },
        }),
      ].join('\n'),
    )
    await writeFile(
      childPath,
      [
        JSON.stringify({ type: 'session_meta', payload: { id: child, agent_path: '/root/child' } }),
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"git push"}' },
        }),
      ].join('\n'),
    )
    await writeFile(siblingPath, 'not json')

    expect(resolveTranscriptFile({ sessionId: root, codexSessionsDir: directory })).toEqual({
      path: rootPath,
      sessionId: root,
    })
    await expect(
      runRetrospectiveTranscript({ sessionId: root, codexSessionsDir: directory }),
    ).resolves.toContain('Subagent tool calls: 1')
  })

  it('returns a stable unavailable block for missing transcripts', async () => {
    await expect(runRetrospectiveTranscript({ sessionId: 'not-a-session' })).resolves.toBe(
      '=== Transcript Facts ===\nStatus: unavailable (invalid session id format)\n',
    )
  })

  it('returns unavailable when a referenced Codex child is missing or malformed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-'))
    const root = '11111111-1111-1111-1111-111111111111'
    const child = '22222222-2222-2222-2222-222222222222'
    await writeFile(
      join(directory, `rollout-2026-${root}.jsonl`),
      [
        JSON.stringify({ type: 'session_meta', payload: { id: root, agent_path: '/root' } }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'sub_agent_activity',
            agent_thread_id: child,
            agent_path: '/root/child',
          },
        }),
      ].join('\n'),
    )

    await expect(
      runRetrospectiveTranscript({ sessionId: root, codexSessionsDir: directory }),
    ).resolves.toBe(
      '=== Transcript Facts ===\nStatus: unavailable (could not resolve a referenced Codex child transcript)\n',
    )
    await writeFile(join(directory, `rollout-2026-${child}.jsonl`), 'not json')
    await expect(
      runRetrospectiveTranscript({ sessionId: root, codexSessionsDir: directory }),
    ).resolves.toContain('Status: unavailable')
  })

  it('rejects ambiguous transcript matches without exposing search paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-'))
    const first = join(directory, 'a')
    const second = join(directory, 'b')
    const sessionId = '11111111-1111-1111-1111-111111111111'
    await mkdir(first)
    await mkdir(second)
    await writeFile(join(first, `rollout-a-${sessionId}.jsonl`), '')
    await writeFile(join(second, `rollout-b-${sessionId}.jsonl`), '')

    const resolved = resolveTranscriptFile({ sessionId, codexSessionsDir: directory })
    expect(resolved).toEqual({ error: `multiple transcripts found for session ${sessionId}` })
    expect(JSON.stringify(resolved)).not.toContain(directory)
  })

  it('sanitizes file-derived labels and unavailable reasons', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-'))
    const path = join(directory, 'session label.jsonl')
    await writeFile(path, claudeLines.join('\n'))

    await expect(runRetrospectiveTranscript({ jsonlPath: path })).resolves.toContain(
      'Session: session_label',
    )
    await expect(
      runRetrospectiveTranscript({
        jsonlPath: join(directory, 'missing.jsonl'),
        sessionId: '11111111-1111-1111-1111-111111111111',
      }),
    ).resolves.toBe('=== Transcript Facts ===\nStatus: unavailable (could not read transcript)\n')
  })

  it('ignores non-push git commands after their options', () => {
    const facts = emptyFacts()
    applyCommand('git -C project status', facts)
    expect(facts.pushCommandAttempts).toBe(0)
  })
})
