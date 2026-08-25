import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

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
})
