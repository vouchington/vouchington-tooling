import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runRetrospectiveTranscript, runRetrospectiveTranscriptReport } from './index.mts'
import { runRetrospectiveTranscriptCommand } from '../cli/commands/retrospective-transcript.mts'

const claude = (timestamp: string, uuid: string): string =>
  JSON.stringify({ type: 'user', uuid, timestamp, message: { content: 'prompt' } })
const codex = (timestamp: string): string =>
  JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'user_message' } })

let directory: string
let claudePath: string
let codexPath: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'transcript-window-'))
  claudePath = join(directory, 'claude.jsonl')
  codexPath = join(directory, 'codex.jsonl')
  await writeFile(
    claudePath,
    [claude('2026-01-01T00:00:00Z', 'a'), claude('2026-01-03T00:00:00Z', 'b')].join('\n'),
  )
  await writeFile(
    codexPath,
    [codex('2026-01-01T00:00:00Z'), codex('2026-01-03T00:00:00Z')].join('\n'),
  )
})
afterAll(() => rm(directory, { recursive: true, force: true }))

describe('windowed transcript report', () => {
  it.each([
    ['Claude', () => claudePath],
    ['Codex', () => codexPath],
  ])('reports the window and excluded count for a %s transcript', async (_name, path) => {
    const report = await runRetrospectiveTranscriptReport({
      jsonlPath: path(),
      since: '2026-01-02T00:00:00Z',
      boundary: 'r1',
    })
    expect(report.coverage).toBe('complete')
    expect(report.markdown).toContain(
      'Window: after 2026-01-02T00:00:00Z (retrospective r1)\nExcluded: 1 events outside the window',
    )
    expect(report.markdown).toContain('User prompts: 1\n')
  })

  it('names an upper bound and leaves a report with no bound unchanged', async () => {
    expect(
      await runRetrospectiveTranscript({ jsonlPath: claudePath, until: '2026-01-02T00:00:00Z' }),
    ).toContain('Window: until 2026-01-02T00:00:00Z\nExcluded: 1 events outside the window')
    const plain = await runRetrospectiveTranscript({ jsonlPath: codexPath })
    expect(plain).not.toContain('Window:')
    expect(plain).not.toContain('Excluded:')
    expect(plain).toContain('User prompts: 2\n')
  })

  it('takes --since and --until on the command line and rejects bad timestamps', async () => {
    const written: string[] = []
    const capture = (chunk: string | Uint8Array): boolean => {
      written.push(String(chunk))
      return true
    }
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(capture)
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(capture)
    try {
      expect(
        await runRetrospectiveTranscriptCommand([
          '--jsonl',
          claudePath,
          '--since',
          '2026-01-02T00:00:00Z',
          '--until',
          '2026-02-01T00:00:00Z',
        ]),
      ).toBe(0)
      expect(await runRetrospectiveTranscriptCommand(['--since', 'yesterday'])).toBe(2)
    } finally {
      out.mockRestore()
      err.mockRestore()
    }
    expect(written[0]).toContain('Excluded: 1 events outside the window')
    expect(written[1]).toBe('--since must be an ISO 8601 timestamp\n')
  })
})
