import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { segmentCodex } from './codex-segment.mts'
import { runRetrospectiveTranscript } from './index.mts'

const directories: string[] = []
const parent = '00000000-0000-4000-8000-000000000001'
const child = '00000000-0000-4000-8000-000000000002'
const descendant = '00000000-0000-4000-8000-000000000003'
const inheritedSibling = '00000000-0000-4000-8000-000000000004'

describe('inherited Codex child transcripts', () => {
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
  })

  it('counts and traverses only the owned segment of a directly supplied child', async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), 'retrospective-inherited-'))
    directories.push(sessionsDir)
    const nested = join(sessionsDir, '2026', '07', '13')
    await mkdir(nested, { recursive: true })
    const timestamp = '2026-07-13T10:00:00.500Z'
    const sessionSeconds = Math.floor(Date.parse(timestamp) / 1000)
    const token = (input: number, output: number): string =>
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: input, output_tokens: output } },
        },
      })
    await writeFile(
      join(nested, `rollout-date-${child}.jsonl`),
      [
        JSON.stringify({
          type: 'session_meta',
          payload: {
            id: child,
            session_id: parent,
            timestamp,
            agent_path: '/root/child',
            source: { subagent: { thread_spawn: { parent_thread_id: parent } } },
          },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'task_started', started_at: sessionSeconds - 10 },
        }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'old' } }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'sub_agent_activity',
            agent_thread_id: inheritedSibling,
            agent_path: '/root/child/inherited-sibling',
          },
        }),
        token(100, 20),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'task_started', started_at: sessionSeconds },
        }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }),
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'function_call', name: 'owned' },
        }),
        token(130, 27),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'sub_agent_activity',
            agent_thread_id: descendant,
            agent_path: '/root/child/descendant',
          },
        }),
      ].join('\n'),
    )
    await writeFile(
      join(nested, `rollout-date-${descendant}.jsonl`),
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { id: descendant, agent_path: '/root/child/descendant' },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'function_call', name: 'descendant' },
        }),
      ].join('\n'),
    )

    await expect(
      runRetrospectiveTranscript({
        jsonlPath: join(nested, `rollout-date-${child}.jsonl`),
        codexSessionsDir: sessionsDir,
      }),
    ).resolves.toContain('Tool calls: 2 (failed: 0)')
    const output = await runRetrospectiveTranscript({
      jsonlPath: join(nested, `rollout-date-${child}.jsonl`),
      codexSessionsDir: sessionsDir,
    })
    expect(output).toContain('User prompts: 1')
    expect(output).toContain('Tokens: input=30 output=7')
    expect(output).toContain('Subagent tool calls: 1')
  })

  it('recognizes every inherited-parent metadata shape and millisecond task starts', () => {
    const timestamp = '2026-07-13T10:00:00.000Z'
    const startedAt = Date.parse(timestamp)
    for (const payload of [
      { source: { subagent: {} } },
      { forked_from_id: parent },
      { parent_thread_id: parent },
      { id: child, session_id: parent },
    ]) {
      expect(
        segmentCodex([
          JSON.stringify({ type: 'session_meta', payload: { ...payload, timestamp } }),
          '{malformed',
          JSON.stringify({ type: 'response_item', payload: {} }),
          JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', started_at: 1 } }),
          JSON.stringify({
            type: 'event_msg',
            payload: { type: 'task_started', started_at: startedAt },
          }),
        ]),
      ).toMatchObject({ lines: [expect.stringContaining('task_started')] })
    }
  })

  it('treats case-equivalent session ids as standalone', () => {
    expect(
      segmentCodex([
        JSON.stringify({
          type: 'session_meta',
          payload: { id: parent.toUpperCase(), session_id: parent },
        }),
        JSON.stringify({ type: 'response_item', payload: { name: 'owned' } }),
      ]),
    ).toMatchObject({ baseline: { input: 0 }, lines: [expect.stringContaining('owned')] })
  })

  it('preserves sub-second boundaries and inherited token high-water marks', () => {
    const timestamp = '2026-07-13T10:00:00.500Z'
    const task = (startedAt: number) =>
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'task_started', started_at: startedAt },
      })
    const token = (input: number, output: number) =>
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: input, output_tokens: output } },
        },
      })
    const segment = segmentCodex([
      JSON.stringify({
        type: 'session_meta',
        payload: { parent_thread_id: parent, timestamp },
      }),
      task(Date.parse('2026-07-13T10:00:00.400Z')),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: {} } }),
      token(100, 20),
      token(80, 15),
      task(Date.parse('2026-07-13T10:00:00.600Z')),
    ])
    expect(segment).toMatchObject({
      baseline: { input: 100, output: 20 },
      lines: [expect.stringContaining(String(Date.parse('2026-07-13T10:00:00.600Z')))],
    })
  })

  it('fails closed when inherited metadata has no valid owned boundary', () => {
    expect(
      segmentCodex([
        JSON.stringify({ type: 'session_meta', payload: { parent_thread_id: parent } }),
      ]),
    ).toBeUndefined()
    expect(
      segmentCodex([
        JSON.stringify({
          type: 'session_meta',
          payload: { parent_thread_id: parent, timestamp: '2026-07-13T10:00:00.000Z' },
        }),
      ]),
    ).toBeUndefined()
  })

  it('reports unavailable when a root or referenced child cannot be segmented', async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), 'retrospective-invalid-segment-'))
    directories.push(sessionsDir)
    const rootPath = join(sessionsDir, `rollout-date-${parent}.jsonl`)
    await writeFile(
      rootPath,
      JSON.stringify({
        type: 'session_meta',
        payload: { id: parent, parent_thread_id: child },
      }),
    )
    await expect(
      runRetrospectiveTranscript({ jsonlPath: rootPath, codexSessionsDir: sessionsDir }),
    ).resolves.toContain('could not segment Codex transcript')

    await writeFile(
      rootPath,
      [
        JSON.stringify({ type: 'session_meta', payload: { id: parent, agent_path: '/root' } }),
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
    await writeFile(
      join(sessionsDir, `rollout-date-${child}.jsonl`),
      JSON.stringify({
        type: 'session_meta',
        payload: { id: child, agent_path: '/root/child', parent_thread_id: parent },
      }),
    )
    await expect(
      runRetrospectiveTranscript({ jsonlPath: rootPath, codexSessionsDir: sessionsDir }),
    ).resolves.toContain('could not resolve a referenced Codex child transcript')
  })
})
