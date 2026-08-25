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
})
