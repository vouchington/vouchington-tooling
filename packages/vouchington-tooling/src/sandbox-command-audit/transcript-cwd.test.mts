import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir, writeLines } from './fixtures.test-helpers.mts'
import { claudeProjectCwdResolver, readTranscriptCwd } from './transcript-cwd.mts'

const withCwd = (cwd: string) => JSON.stringify({ type: 'user', cwd })

describe('readTranscriptCwd', () => {
  it('reads a top-level cwd and a Codex payload cwd', async () => {
    const dir = tempDir()
    expect(await readTranscriptCwd(writeLines(join(dir, 'a.jsonl'), [withCwd('/repo')]))).toBe(
      '/repo',
    )
    const payload = JSON.stringify({ type: 'session_meta', payload: { cwd: '/codex' } })
    expect(await readTranscriptCwd(writeLines(join(dir, 'b.jsonl'), [payload]))).toBe('/codex')
  })

  it('skips malformed, empty-cwd, non-object and cwd-less lines', async () => {
    const lines = [
      '{bad',
      '',
      '7',
      'null',
      '{"cwd":""}',
      '{"payload":{"cwd":""}}',
      '{"type":"x"}',
      withCwd('/ok'),
    ]
    expect(await readTranscriptCwd(writeLines(join(tempDir(), 'a.jsonl'), lines))).toBe('/ok')
  })

  it('returns undefined when no line carries a cwd', async () => {
    expect(
      await readTranscriptCwd(writeLines(join(tempDir(), 'a.jsonl'), ['{"type":"x"}'])),
    ).toBeUndefined()
  })

  it('does not parse a prefix cut mid-record, and streams the rest of a large file', async () => {
    const filler = JSON.stringify({ type: 'x', pad: 'p'.repeat(70 * 1024) })
    const path = writeLines(join(tempDir(), 'big.jsonl'), [filler, withCwd('/late')])
    expect(await readTranscriptCwd(path)).toBe('/late')
  })

  it('returns undefined when a large file never names a cwd, skipping malformed lines', async () => {
    const filler = JSON.stringify({ type: 'x', pad: 'p'.repeat(70 * 1024) })
    expect(
      await readTranscriptCwd(writeLines(join(tempDir(), 'big.jsonl'), [filler, '{bad', ''])),
    ).toBeUndefined()
  })

  it('rejects when the file cannot be opened', async () => {
    await expect(readTranscriptCwd(join(tempDir(), 'missing.jsonl'))).rejects.toThrow()
  })

  it('rejects when the streamed rescan cannot read an oversized record', async () => {
    const huge = JSON.stringify({ pad: 'p'.repeat(2.1 * 1024 * 1024) })
    await expect(
      readTranscriptCwd(writeLines(join(tempDir(), 'big.jsonl'), [huge])),
    ).rejects.toThrow('exceeds')
  })
})

describe('claudeProjectCwdResolver', () => {
  it('resolves a subagent transcript through its project top-level session and memoizes it', async () => {
    const root = tempDir()
    writeLines(join(root, 'proj', 'top.jsonl'), [withCwd('/repo')])
    const subagent = writeLines(join(root, 'proj', 'top', 'subagents', 'agent-1.jsonl'), [
      '{"type":"x"}',
    ])
    const resolve = claudeProjectCwdResolver(root)
    expect(await resolve(subagent)).toBe('/repo')
    writeLines(join(root, 'proj', 'top.jsonl'), [withCwd('/changed')])
    expect(await resolve(join(root, 'proj', 'top.jsonl'))).toBe('/repo')
  })

  it('tries the next session file and returns undefined when none has a cwd', async () => {
    const root = tempDir()
    writeLines(join(root, 'proj', 'a.jsonl'), ['{"type":"x"}'])
    expect(await claudeProjectCwdResolver(root)(join(root, 'proj', 'a.jsonl'))).toBeUndefined()
    writeLines(join(root, 'both', 'a.jsonl'), ['{"type":"x"}'])
    writeLines(join(root, 'both', 'b.jsonl'), [withCwd('/b')])
    expect(await claudeProjectCwdResolver(root)(join(root, 'both', 'a.jsonl'))).toBe('/b')
  })

  it('does not cache a failed lookup', async () => {
    const root = tempDir()
    mkdirSync(join(root, 'proj'))
    writeFileSync(join(root, 'proj', 'a.jsonl'), 'x'.repeat(70 * 1024) + '\n')
    const resolve = claudeProjectCwdResolver(root)
    const path = join(root, 'proj', 'a.jsonl')
    writeFileSync(path, `${JSON.stringify({ pad: 'p'.repeat(2.1 * 1024 * 1024) })}\n`)
    await expect(resolve(path)).rejects.toThrow()
    writeLines(path, [withCwd('/fixed')])
    expect(await resolve(path)).toBe('/fixed')
  })
})
