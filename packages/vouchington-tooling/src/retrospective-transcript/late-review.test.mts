import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  computeTranscriptFacts,
  resolveTranscriptFile,
  runRetrospectiveTranscript,
} from './index.mts'
import { applyCommand, emptyFacts } from './shared.mts'

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CHILD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OTHER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('late retrospective transcript review regressions', () => {
  it('extracts non-interpolated template-literal commands from custom exec calls', () => {
    const record = (input: string): string =>
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'exec', input },
      })
    const facts = computeTranscriptFacts([
      record('await tools.exec_command({cmd: `git push\\npnpm exec no-mistakes`})'),
      record('await tools.exec_command({cmd: `echo ${unsafe}`})'),
    ])
    expect(facts).toMatchObject({ noMistakesInvocations: 1, pushCommandAttempts: 1 })
  })

  it('recognizes npm exec options and Windows Git executable names', () => {
    const facts = emptyFacts()
    applyCommand(
      "npm exec --package=no-mistakes -- no-mistakes; npm exec -c 'no-mistakes'; npm exec --package no-mistakes no-mistakes; npm exec -p no-mistakes no-mistakes; npm exec --call 'no-mistakes'; npm exec --package=no-mistakes; npm exec -c; git.exe push; 'C:\\Program Files\\Git\\cmd\\git.exe' push",
      facts,
    )
    expect(facts).toMatchObject({ noMistakesInvocations: 5, pushCommandAttempts: 2 })
  })

  it('distinguishes here-strings, unwraps env, and discards unterminated quotes', () => {
    const facts = emptyFacts()
    applyCommand(
      "cat <<< value\ngit push; env CI=1 no-mistakes; env -i CI=1 no-mistakes; /usr/bin/env -u OLD CI=1 git push; env -- CI=1 git push; echo 'foo\\'; git push; git 'push",
      facts,
    )
    expect(facts).toMatchObject({ noMistakesInvocations: 2, pushCommandAttempts: 4 })
  })

  it('retains cumulative token high-water marks across temporary decreases', () => {
    const tokenRecord = (input: number): string =>
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              cached_input_tokens: 0,
              input_tokens: input,
              output_tokens: 0,
            },
          },
        },
      })
    expect(
      computeTranscriptFacts([tokenRecord(10), tokenRecord(8), tokenRecord(12)]),
    ).toMatchObject({ tokens: { input: 12 } })
  })

  it('normalizes uppercase session IDs for case-sensitive discovery', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-late-review-'))
    const path = join(directory, `rollout-root-${SESSION_ID}.jsonl`)
    await writeFile(path, JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }))
    expect(
      resolveTranscriptFile({
        codexSessionsDir: directory,
        grokSessionsDir: directory,
        projectsDir: directory,
        sessionId: SESSION_ID.toUpperCase(),
      }),
    ).toEqual({ path, sessionId: SESSION_ID })
  })

  it('seeds a metadata-free explicit Codex root from its rollout filename', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-late-review-'))
    const path = join(directory, `rollout-root-${SESSION_ID}.jsonl`)
    await writeFile(
      path,
      [
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'sub_agent_activity',
            agent_path: '/root/self',
            agent_thread_id: SESSION_ID,
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"git push"}' },
        }),
      ].join('\n'),
    )
    await expect(runRetrospectiveTranscript({ jsonlPath: path })).resolves.toContain(
      'Subagent tool calls: 0',
    )
  })

  it('rejects structurally invalid interior records', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-late-review-'))
    const path = join(directory, `rollout-root-${SESSION_ID}.jsonl`)
    await writeFile(
      path,
      [
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
        'null',
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }),
        '',
      ].join('\n'),
    )
    await expect(runRetrospectiveTranscript({ jsonlPath: path })).resolves.toContain(
      'malformed interior transcript record',
    )
  })

  it('rejects a resolved Codex child whose metadata belongs to another identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-late-review-'))
    const root = join(directory, `rollout-root-${SESSION_ID}.jsonl`)
    await writeFile(
      root,
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { id: SESSION_ID, agent_path: '/root' },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'sub_agent_activity',
            agent_path: '/root/child',
            agent_thread_id: CHILD_ID,
          },
        }),
      ].join('\n'),
    )
    await writeFile(
      join(directory, `rollout-child-${CHILD_ID}.jsonl`),
      JSON.stringify({
        type: 'session_meta',
        payload: { id: OTHER_ID, agent_path: '/root/other' },
      }),
    )
    await expect(runRetrospectiveTranscript({ jsonlPath: root })).resolves.toContain(
      'could not resolve a referenced Codex child transcript',
    )
  })
})
