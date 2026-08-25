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
import { applyCommand, emptyFacts } from './shared.mts'

const ROOT_ID = '11111111-1111-1111-1111-111111111111'
const CHILD_ID = '22222222-2222-2222-2222-222222222222'
const GRANDCHILD_ID = '33333333-3333-3333-3333-333333333333'

function sessionMeta(id: string, agentPath: string): string {
  return JSON.stringify({ type: 'session_meta', payload: { id, agent_path: agentPath } })
}

function childActivity(threadId: string, agentPath: string): string {
  return JSON.stringify({
    type: 'event_msg',
    payload: { type: 'sub_agent_activity', agent_thread_id: threadId, agent_path: agentPath },
  })
}

describe('retrospective transcript resilience', () => {
  it('counts structured Claude prompts while excluding tool-result-only records and null JSON', () => {
    const facts = computeTranscriptFacts([
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'hello' }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'image' }] } }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', content: 'ok' }] },
      }),
      JSON.stringify({
        type: 'user',
        message: { content: { type: 'text', text: 'not a block list' } },
      }),
      'null',
    ])
    expect(facts.userPrompts).toBe(2)
  })
  it('correlates failed Codex outcomes and deduplicates hosted calls', () => {
    const facts = computeTranscriptFacts([
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'shell-1',
          name: 'shell',
          arguments: '{"cmd":"git push"}',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'shell-1', output: { exit_code: 1 } },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'web_search_call', id: 'search-1' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'web_search_call', id: 'search-1' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'local_shell_call',
          call_id: 'local-1',
          input: { command: 'pnpm exec no-mistakes && git push' },
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'local_shell_call_output', call_id: 'local-1', exit_code: 1 },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'local_shell_call', call_id: 'local-empty', input: {} },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', call_id: 'object-input', name: 'shell', arguments: {} },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'object-input',
          exit_code: 0,
          exitCode: 1,
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'array-outcome',
          name: 'other',
          arguments: '{}',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'array-outcome',
          output: [{ status: 'failed' }],
        },
      }),
    ])
    expect(facts).toMatchObject({
      toolCalls: 6,
      failedToolCalls: 4,
      noMistakesInvocations: 1,
      pushCommandAttempts: 2,
    })
  })
  it('extracts shell commands from Codex custom exec calls', () => {
    const facts = computeTranscriptFacts([
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          call_id: 'custom-exec',
          name: 'exec',
          input: 'await tools.exec_command({cmd: "echo ok\\ngit push && pnpm exec no-mistakes"})',
        },
      }),
    ])
    expect(facts).toMatchObject({ toolCalls: 1, noMistakesInvocations: 1, pushCommandAttempts: 1 })
  })
  it('extracts every custom exec command and parses textual failed outcomes', () => {
    const facts = computeTranscriptFacts([
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          call_id: 'custom-exec',
          name: 'exec',
          input:
            'await tools.exec_command({cmd: "pnpm exec no-mistakes"}); await tools.exec_command({cmd: "git push"})',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'custom-exec',
          output: [{ type: 'input_text', text: '{"exit_code":1}' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'ignored-text',
          output: [{ type: 'input_text', text: '{' }],
        },
      }),
    ])
    expect(facts).toMatchObject({
      toolCalls: 1,
      failedToolCalls: 1,
      noMistakesInvocations: 1,
      pushCommandAttempts: 1,
    })
  })
  it('treats configured transcript roots literally', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'retrospective-transcript-resilience-'))
    const directory = join(parent, 'sessions[1]')
    const sessionId = '88888888-8888-4888-8888-888888888888'
    const path = join(directory, `rollout-root-${sessionId}.jsonl`)
    await mkdir(directory)
    await writeFile(path, JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }))

    expect(resolveTranscriptFile({ sessionId, codexSessionsDir: directory })).toEqual({
      path,
      sessionId,
    })
  })
  it('rejects malformed interior records while tolerating a torn final line', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-resilience-'))
    const sessionId = '88888888-8888-4888-8888-888888888888'
    const transcript = join(directory, `rollout-root-${sessionId}.jsonl`)
    await writeFile(
      transcript,
      [
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
        '{',
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }),
      ].join('\n'),
    )
    await expect(
      runRetrospectiveTranscript({ sessionId, codexSessionsDir: directory }),
    ).resolves.toContain('Status: unavailable (malformed interior transcript record)')

    await writeFile(
      transcript,
      [JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }), '{'].join('\n'),
    )
    await expect(
      runRetrospectiveTranscript({ sessionId, codexSessionsDir: directory }),
    ).resolves.toContain('User prompts: 1')
  })
  it('rejects malformed interior Claude records while tolerating a torn final line', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-resilience-'))
    const path = join(directory, 'claude.jsonl')
    await writeFile(
      path,
      [
        JSON.stringify({ type: 'user', message: { content: 'first' } }),
        '{',
        JSON.stringify({ type: 'user', message: { content: 'second' } }),
      ].join('\n'),
    )
    await expect(runRetrospectiveTranscript({ jsonlPath: path })).resolves.toContain(
      'Status: unavailable (malformed interior transcript record)',
    )

    await writeFile(
      path,
      [JSON.stringify({ type: 'user', message: { content: 'first' } }), '{'].join('\n'),
    )
    await expect(runRetrospectiveTranscript({ jsonlPath: path })).resolves.toContain(
      'User prompts: 1',
    )
  })
  it('accepts Claude subagents supplied as line arrays and ignores blank records', () => {
    const parent = [JSON.stringify({ type: 'user', message: { content: 'parent' } })]
    const child = [
      '',
      JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git push' } }],
        },
      }),
    ]

    expect(computeTranscriptFacts(parent, [child])).toMatchObject({
      userPrompts: 1,
      pushCommandAttempts: 1,
      subagentToolCalls: 1,
    })
    expect(computeTranscriptFacts([''])).toMatchObject({ userPrompts: 0, toolCalls: 0 })
  })
  it('rejects a direct Codex child with an invalid thread identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-resilience-'))
    const rootPath = join(directory, `rollout-root-${ROOT_ID}.jsonl`)
    await writeFile(
      rootPath,
      [sessionMeta(ROOT_ID, '/root'), childActivity('invalid', '/root/bad')].join('\n'),
    )

    await expect(
      runRetrospectiveTranscript({ sessionId: ROOT_ID, codexSessionsDir: directory }),
    ).resolves.toContain('could not resolve a referenced Codex child transcript')
  })
  it('validates environment identities before using the default Codex session root', async () => {
    const projectsDir = await mkdtemp(join(tmpdir(), 'retrospective-transcript-resilience-'))

    expect(resolveTranscriptFile({ env: { CODEX_THREAD_ID: 'invalid' }, projectsDir })).toEqual({
      error: 'invalid session id format',
    })
    expect(resolveTranscriptFile({ env: { CODEX_THREAD_ID: GRANDCHILD_ID }, projectsDir })).toEqual(
      {
        error: `no transcript found for session ${GRANDCHILD_ID}`,
      },
    )
  })
  it('discovers Grok transcripts and Claude-compatible Cursor transcripts from their session ids', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-resilience-'))
    const grokSessionsDir = join(directory, 'grok')
    const projectsDir = join(directory, 'projects')
    const grokSession = '44444444-4444-4444-8444-444444444444'
    const cursorSession = '55555555-5555-4555-8555-555555555555'
    const cwd = '/workspace/project'
    const grokPath = join(grokSessionsDir, encodeURIComponent(cwd), grokSession, 'updates.jsonl')
    const cursorPath = join(projectsDir, 'project', `${cursorSession}.jsonl`)
    await mkdir(join(grokSessionsDir, encodeURIComponent(cwd), grokSession), { recursive: true })
    await mkdir(join(projectsDir, 'project'), { recursive: true })
    await writeFile(grokPath, JSON.stringify({ type: 'user', message: { content: 'Grok' } }))
    await writeFile(cursorPath, JSON.stringify({ type: 'user', message: { content: 'Cursor' } }))

    expect(
      resolveTranscriptFile({
        env: { GROK_SESSION_ID: grokSession },
        grokSessionsDir,
        projectsDir,
        cwd,
      }),
    ).toEqual({ path: grokPath, sessionId: grokSession })
    await expect(
      runRetrospectiveTranscript({
        env: { GROK_SESSION_ID: grokSession },
        grokSessionsDir,
        projectsDir,
        cwd,
      }),
    ).resolves.toContain('User prompts: 1')
    expect(
      resolveTranscriptFile({
        env: { CURSOR_SESSION_ID: cursorSession },
        grokSessionsDir,
        projectsDir,
      }),
    ).toEqual({ path: cursorPath, sessionId: cursorSession })
    await expect(
      runRetrospectiveTranscript({
        env: { CURSOR_SESSION_ID: cursorSession },
        grokSessionsDir,
        projectsDir,
      }),
    ).resolves.toContain('User prompts: 1')
  })
  it('deduplicates advisor tool calls and preserves them in formatted output', () => {
    const facts = computeTranscriptFacts([
      JSON.stringify({ type: 'user', message: { content: 'review this' } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'advisor', id: 'advisor-1' },
            { type: 'advisor_tool_result', tool_use_id: 'advisor-1' },
          ],
        },
      }),
    ])

    expect(facts.advisorCalls).toBe(1)
    expect(formatTranscriptFacts('session', facts)).toContain('advisor calls: 1')
  })
  it('deduplicates advisor calls in Codex transcripts', () => {
    const facts = computeTranscriptFacts([
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', call_id: 'advisor-1', name: 'advisor', arguments: '{}' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', call_id: 'advisor-1', name: 'advisor', arguments: '{}' },
      }),
    ])
    expect(facts).toMatchObject({ toolCalls: 1, advisorCalls: 1 })
  })
  it('recognizes escaped shell syntax, Windows binaries, and package-manager launchers', () => {
    const facts = emptyFacts()
    applyCommand(
      'pnpm dlx no-mistakes; npm exec no-mistakes; C:\\tools\\no-mistakes.cmd; git commit -m "fix: \\"quote\\""; git \\\n+push; git push \\; echo ignored',
      facts,
    )

    expect(facts.noMistakesInvocations).toBe(3)
    expect(facts.pushCommandAttempts).toBe(1)
  })
  it('does not treat a shell token ending in an escape as a completed command', () => {
    const facts = emptyFacts()
    applyCommand('git push\\', facts)
    expect(facts.pushCommandAttempts).toBe(0)
  })
  it('ignores separator-looking commands inside shell comments', () => {
    const facts = emptyFacts()
    applyCommand(
      'echo done # disabled; git push && pnpm exec no-mistakes\npnpm exec no-mistakes',
      facts,
    )
    expect(facts).toMatchObject({ noMistakesInvocations: 1, pushCommandAttempts: 0 })
  })
  it('uses host environment identities when no injected environment is supplied', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-resilience-'))
    const sessionId = '66666666-6666-4666-8666-666666666666'
    const project = join(directory, 'project')
    const original = process.env.CURSOR_SESSION_ID
    const originalCodex = process.env.CODEX_THREAD_ID
    const originalClaude = process.env.CLAUDE_CODE_SESSION_ID
    const originalGrok = process.env.GROK_SESSION_ID
    await mkdir(project, { recursive: true })
    await writeFile(
      join(project, `${sessionId}.jsonl`),
      JSON.stringify({ type: 'user', message: { content: 'Cursor' } }),
    )
    delete process.env.CODEX_THREAD_ID
    delete process.env.CLAUDE_CODE_SESSION_ID
    delete process.env.GROK_SESSION_ID
    process.env.CURSOR_SESSION_ID = sessionId
    try {
      await expect(runRetrospectiveTranscript({ projectsDir: directory })).resolves.toContain(
        'User prompts: 1',
      )
    } finally {
      if (original === undefined) delete process.env.CURSOR_SESSION_ID
      else process.env.CURSOR_SESSION_ID = original
      if (originalCodex === undefined) delete process.env.CODEX_THREAD_ID
      else process.env.CODEX_THREAD_ID = originalCodex
      if (originalClaude === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
      else process.env.CLAUDE_CODE_SESSION_ID = originalClaude
      if (originalGrok === undefined) delete process.env.GROK_SESSION_ID
      else process.env.GROK_SESSION_ID = originalGrok
    }
  })
  it('keeps a leading Codex event when no session metadata precedes it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-resilience-'))
    const sessionId = '77777777-7777-4777-8777-777777777777'
    await writeFile(
      join(directory, `rollout-root-${sessionId}.jsonl`),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
    )

    await expect(
      runRetrospectiveTranscript({ sessionId, codexSessionsDir: directory }),
    ).resolves.toContain('User prompts: 1')
  })
  it('uses configured agent homes for default transcript discovery', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-resilience-'))
    const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const sessions = join(directory, 'sessions')
    await mkdir(sessions)
    await writeFile(
      join(sessions, `rollout-root-${sessionId}.jsonl`),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
    )
    await expect(
      runRetrospectiveTranscript({ env: { CODEX_HOME: directory, CODEX_THREAD_ID: sessionId } }),
    ).resolves.toContain('User prompts: 1')
    const projects = join(directory, 'projects')
    await mkdir(join(projects, 'project'), { recursive: true })
    await writeFile(
      join(projects, 'project', `${sessionId}.jsonl`),
      JSON.stringify({ type: 'user', message: { content: 'Claude' } }),
    )
    await expect(
      runRetrospectiveTranscript({
        env: { CLAUDE_CONFIG_DIR: directory, CLAUDE_CODE_SESSION_ID: sessionId },
      }),
    ).resolves.toContain('User prompts: 1')
  })
  it('seeds metadata-free Codex roots to avoid self-child double counting', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-resilience-'))
    const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await writeFile(
      join(directory, `rollout-root-${sessionId}.jsonl`),
      [
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
        childActivity(sessionId, '/root/self'),
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'function_call', name: 'other', arguments: '{}' },
        }),
      ].join('\n'),
    )
    await expect(
      runRetrospectiveTranscript({ sessionId, codexSessionsDir: directory }),
    ).resolves.toContain('Subagent tool calls: 0')
  })
  it('keeps a leading Codex child event when no child session metadata precedes it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-resilience-'))
    await writeFile(
      join(directory, `rollout-root-${ROOT_ID}.jsonl`),
      [sessionMeta(ROOT_ID, '/root'), childActivity(CHILD_ID, '/root/child')].join('\n'),
    )
    await writeFile(
      join(directory, `rollout-child-${CHILD_ID}.jsonl`),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"git push"}' },
      }),
    )
    await expect(
      runRetrospectiveTranscript({ sessionId: ROOT_ID, codexSessionsDir: directory }),
    ).resolves.toContain('Subagent tool calls: 1')
  })
  it('skips visited Codex identities and propagates a missing nested child', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-resilience-'))
    await writeFile(
      join(directory, `rollout-root-${ROOT_ID}.jsonl`),
      [
        sessionMeta(ROOT_ID, '/root'),
        childActivity(ROOT_ID, '/root/self'),
        childActivity(CHILD_ID, '/root/child'),
      ].join('\n'),
    )
    await writeFile(
      join(directory, `rollout-child-${CHILD_ID}.jsonl`),
      [
        sessionMeta(CHILD_ID, '/root/child'),
        childActivity(GRANDCHILD_ID, '/root/child/grandchild'),
      ].join('\n'),
    )
    await expect(
      runRetrospectiveTranscript({ sessionId: ROOT_ID, codexSessionsDir: directory }),
    ).resolves.toContain('could not resolve a referenced Codex child transcript')
  })
})
