import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  computeTranscriptFacts,
  resolveTranscriptFile,
  runRetrospectiveTranscript,
} from './index.mts'

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
