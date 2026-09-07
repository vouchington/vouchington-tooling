import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTranscriptFile } from './index.mts'

describe('retrospective transcript environment selection', () => {
  it('preserves the caller-owned Codex, Claude, Cursor, Grok precedence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-environment-'))
    const codexSession = '11111111-1111-1111-1111-111111111111'

    expect(
      resolveTranscriptFile({
        codexSessionsDir: directory,
        env: {
          CLAUDE_CODE_SESSION_ID: '22222222-2222-2222-2222-222222222222',
          CODEX_THREAD_ID: codexSession,
          CURSOR_SESSION_ID: '33333333-3333-3333-3333-333333333333',
          GROK_SESSION_ID: '44444444-4444-4444-8444-444444444444',
        },
        projectsDir: directory,
      }),
    ).toEqual({ error: `no transcript found for session ${codexSession}` })
  })
})
