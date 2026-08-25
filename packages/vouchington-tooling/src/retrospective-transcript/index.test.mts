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
})
