import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendJournal, assertSessionId, resolveBlackboardConnection } from './index.mts'

describe('agent blackboard', () => {
  it('requires both explicit connection credentials', () => {
    expect(() => resolveBlackboardConnection({})).toThrow('AGENT_BLACKBOARD_URL')
    expect(() =>
      resolveBlackboardConnection({ AGENT_BLACKBOARD_URL: 'https://example.test' }),
    ).toThrow('AGENT_BLACKBOARD_TOKEN')
    expect(
      resolveBlackboardConnection({
        AGENT_BLACKBOARD_URL: 'https://example.test',
        AGENT_BLACKBOARD_TOKEN: 'token',
      }),
    ).toEqual({ baseUrl: 'https://example.test', token: 'token', readRetry: {} })
  })

  it('accepts URL-safe session identities and rejects unsafe path and URL characters', () => {
    for (const sessionId of ['codex:child.branch_01', '00000000-0000-4000-8000-000000000000'])
      expect(() => assertSessionId(sessionId)).not.toThrow()
    for (const sessionId of ['../not-a-session', 'session/id', 'session?query', 'session%20id'])
      expect(() => assertSessionId(sessionId)).toThrow('URL-safe')
  })

  it('rejects malformed UTF-8 before resolving credentials or loading the optional client', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'blackboard-utf8-'))
    const file = join(directory, 'note.md')
    await writeFile(file, Buffer.from([0xc3, 0x28]))
    try {
      await expect(
        appendJournal({ sessionId: 'session:1', agent: 'codex', version: '1', markdownFile: file }),
      ).rejects.toThrow('not valid UTF-8')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
