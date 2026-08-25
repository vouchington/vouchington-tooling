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
      ]),
    ).resolves.toBe(0)
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain('User prompts: 1')
  })

  it('reports invalid arguments without throwing', async () => {
    await expect(runRetrospectiveTranscriptCommand(['--unknown'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('Unknown option')
  })
})
