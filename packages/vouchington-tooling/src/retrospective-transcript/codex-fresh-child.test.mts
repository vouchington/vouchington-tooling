import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { explainCodexSegment } from './codex-segment.mts'
import { runRetrospectiveTranscript } from './index.mts'

const directories: string[] = []
const parent = '00000000-0000-4000-8000-000000000011'
const child = '00000000-0000-4000-8000-000000000012'
const timestamp = '2026-07-13T10:00:00.000Z'
const startedAt = Math.floor(Date.parse(timestamp) / 1000) + 5

const meta = (payload: object) => JSON.stringify({ type: 'session_meta', payload })
const event = (payload: object) => JSON.stringify({ type: 'event_msg', payload })
const childMeta = (extra: object = {}) =>
  meta({
    id: child,
    session_id: parent,
    parent_thread_id: parent,
    agent_path: '/root/child',
    timestamp,
    source: { subagent: { other: 'guardian' } },
    ...extra,
  })

describe('Codex children that inherited no history', () => {
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
  })

  it('segments a fresh subagent whose first record is its own task start', () => {
    const outcome = explainCodexSegment([
      childMeta(),
      event({ type: 'task_started', started_at: startedAt }),
      event({ type: 'token_count', info: { total_token_usage: { input_tokens: 7 } } }),
    ])
    expect(outcome).toMatchObject({
      segment: {
        baseline: { input: 0, output: 0 },
        lines: [expect.any(String), expect.any(String)],
      },
    })
  })

  it('names why a child cannot be segmented', () => {
    expect(explainCodexSegment([childMeta({ timestamp: undefined })])).toEqual({
      reason: 'the inherited child session_meta has no valid timestamp',
    })
    expect(explainCodexSegment([childMeta()])).toEqual({
      reason: 'no task_started at or after the child session start was recorded',
    })
  })

  it('reads a parent that spawns one fresh child in the current rollout layout', async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), 'retrospective-fresh-child-'))
    directories.push(sessionsDir)
    const rootPath = join(sessionsDir, `rollout-date-${parent}.jsonl`)
    await writeFile(
      rootPath,
      [
        meta({ id: parent, agent_path: '/root' }),
        event({
          type: 'sub_agent_activity',
          agent_thread_id: child,
          agent_path: '/root/child',
        }),
      ].join('\n'),
    )
    const childPath = join(sessionsDir, `rollout-date-${child}.jsonl`)
    await writeFile(
      childPath,
      [childMeta(), event({ type: 'task_started', started_at: startedAt })].join('\n'),
    )
    const output = await runRetrospectiveTranscript({
      jsonlPath: rootPath,
      codexSessionsDir: sessionsDir,
    })
    expect(output).not.toContain('could not')

    await writeFile(childPath, childMeta())
    await expect(
      runRetrospectiveTranscript({ jsonlPath: rootPath, codexSessionsDir: sessionsDir }),
    ).resolves.toContain(
      'could not resolve a referenced Codex child transcript: could not segment it (no task_started',
    )

    await writeFile(rootPath, childMeta())
    await expect(
      runRetrospectiveTranscript({ jsonlPath: rootPath, codexSessionsDir: sessionsDir }),
    ).resolves.toContain('could not segment Codex transcript: no task_started')
  })
})
