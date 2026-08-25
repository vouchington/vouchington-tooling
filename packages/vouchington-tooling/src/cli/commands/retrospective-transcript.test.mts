import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../index.mts'
import { runRetrospectiveTranscriptCommand } from './retrospective-transcript.mts'

describe('runRetrospectiveTranscriptCommand', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    stdout.mockClear()
    stderr.mockClear()
  })

  it('writes transcript facts through the CLI dispatcher', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-cli-'))
    const transcript = join(directory, 'session.jsonl')
    await writeFile(transcript, JSON.stringify({ type: 'user', message: { content: 'hello' } }))

    await expect(
      runCli([
        'node',
        'vouchington',
        'retrospective-transcript',
        '--session-id',
        '11111111-1111-4111-8111-111111111111',
        '--jsonl',
        transcript,
        '--projects-dir',
        directory,
        '--codex-sessions-dir',
        directory,
        '--grok-sessions-dir',
        directory,
      ]),
    ).resolves.toBe(0)
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain('User prompts: 1')
  })

  it('reports invalid arguments without throwing', async () => {
    await expect(runRetrospectiveTranscriptCommand(['--unknown'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('Unknown option')
  })

  it('accepts default transcript discovery options', async () => {
    await expect(runRetrospectiveTranscriptCommand([])).resolves.toBe(0)
  })

  it('uses the CLI process environment for default session discovery', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retrospective-transcript-cli-'))
    const sessionId = '99999999-9999-4999-8999-999999999999'
    const original = process.env.CODEX_THREAD_ID
    await writeFile(
      join(directory, `rollout-root-${sessionId}.jsonl`),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
    )
    process.env.CODEX_THREAD_ID = sessionId
    try {
      await expect(
        runRetrospectiveTranscriptCommand(['--codex-sessions-dir', directory]),
      ).resolves.toBe(0)
      expect(String(stdout.mock.calls.at(-1)?.[0])).toContain('User prompts: 1')
    } finally {
      if (original === undefined) delete process.env.CODEX_THREAD_ID
      else process.env.CODEX_THREAD_ID = original
    }
  })
})
