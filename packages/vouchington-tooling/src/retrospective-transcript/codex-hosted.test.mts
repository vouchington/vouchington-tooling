import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeTranscriptFacts, runRetrospectiveTranscript } from './index.mts'

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('hosted Codex transcripts', () => {
  it('counts current conversation roles while ignoring non-conversation messages', () => {
    const message = (role: string): string =>
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role, content: [] } })
    const facts = computeTranscriptFacts([
      message('user'),
      message('assistant'),
      message('developer'),
      message('system'),
      message('tool'),
      JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', role: 'assistant' } }),
    ])

    expect(facts).toMatchObject({ userPrompts: 1, assistantResponses: 1 })
  })

  it('prefers current messages over duplicate legacy events', () => {
    const facts = computeTranscriptFacts([
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [] },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [] },
      }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }),
    ])

    expect(facts).toMatchObject({ userPrompts: 1, assistantResponses: 1 })
  })

  it('falls back to legacy events independently for each absent current role', () => {
    const currentUser = computeTranscriptFacts([
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [] },
      }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }),
    ])
    const currentAssistant = computeTranscriptFacts([
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [] },
      }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }),
    ])

    expect(currentUser).toMatchObject({ userPrompts: 1, assistantResponses: 1 })
    expect(currentAssistant).toMatchObject({ userPrompts: 1, assistantResponses: 1 })
  })

  it('preserves compacted facts and excludes current child messages from root counts', () => {
    const root = [
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [] },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [] },
      }),
      JSON.stringify({ type: 'compacted', payload: {} }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 10, output_tokens: 5 } },
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', call_id: 'root-call', name: 'other' },
      }),
    ]
    const child = [
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [] },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [] },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', call_id: 'child-call', name: 'other' },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 3, output_tokens: 2 } },
        },
      }),
    ]

    expect(
      computeTranscriptFacts(root, [
        { lines: child, baseline: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } },
      ]),
    ).toMatchObject({
      userPrompts: 1,
      assistantResponses: 1,
      toolCalls: 2,
      compactions: 1,
      tokens: { input: 10, output: 5 },
      subagentToolCalls: 1,
      subagentTokens: { input: 3, output: 2 },
    })
  })

  it('normalizes string and array local-shell commands while ignoring malformed arrays', () => {
    const line = (callId: string, command: unknown): string =>
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'local_shell_call', call_id: callId, input: command },
      })
    expect(
      computeTranscriptFacts([
        line('string', { command: 'git push' }),
        line('array', { action: { type: 'exec', command: ['pnpm exec', 'no-mistakes'] } }),
        line('invalid', { action: { type: 'exec', command: [1] } }),
      ]),
    ).toMatchObject({ toolCalls: 3, noMistakesInvocations: 1, pushCommandAttempts: 1 })
  })

  it('uses the default Codex sessions directory when no explicit path is supplied', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'retrospective-transcript-hosted-'))
    const sessions = join(codexHome, 'sessions')
    await mkdir(sessions)
    await writeFile(
      join(sessions, `rollout-root-${SESSION_ID}.jsonl`),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
    )
    await expect(
      runRetrospectiveTranscript({ sessionId: SESSION_ID, env: { CODEX_HOME: codexHome } }),
    ).resolves.toContain('User prompts: 1')
  })

  it('falls back to the user Codex home when an empty environment root is supplied', async () => {
    const projectsDir = await mkdtemp(join(tmpdir(), 'retrospective-transcript-hosted-'))
    const project = join(projectsDir, 'project')
    await mkdir(project)
    await writeFile(
      join(project, `${SESSION_ID}.jsonl`),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
    )
    await expect(
      runRetrospectiveTranscript({
        env: { CODEX_HOME: '', CODEX_THREAD_ID: SESSION_ID },
        projectsDir,
      }),
    ).resolves.toContain('User prompts: 1')
  })
})
