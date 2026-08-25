import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeTranscriptFacts, runRetrospectiveTranscript } from './index.mts'

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('hosted Codex transcripts', () => {
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
})
