import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bashUse, jsonl, tempDir, toolResult, writeLines } from './fixtures.test-helpers.mts'
import { scanTranscripts } from './scan.mts'
import type { ClassifyFailure } from './types.mts'

const cwdRecord = { type: 'system', cwd: '/repo' }
const meta = { type: 'session_meta', payload: { cwd: '/repo' } }
const claim: ClassifyFailure = (command, text) =>
  text.includes('read-only') ? 'write-path' : undefined

function fixture() {
  const base = tempDir()
  const projectsDir = join(base, 'projects')
  const codexSessionsDir = join(base, 'sessions')
  writeLines(
    join(projectsDir, 'p', 'a.jsonl'),
    jsonl(
      cwdRecord,
      bashUse('1', 'pnpm install', { dangerouslyDisableSandbox: true }),
      toolResult('1', 'read-only file system'),
      bashUse('2', 'rm -rf /'),
      toolResult('2', 'no', { toolDenialKind: 'user-rejected' }),
      bashUse('3', 'curl x'),
      toolResult('3', 'permission denied'),
    ),
  )
  writeLines(
    join(codexSessionsDir, 'd', 'rollout-1-x.jsonl'),
    jsonl(meta, {
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: { type: 'CommandExecution', command: 'git fetch', aggregated_output: 'read-only' },
      },
    }),
  )
  return { base, projectsDir, codexSessionsDir }
}

describe('scanTranscripts', () => {
  it('folds both harnesses into one result', async () => {
    const { projectsDir, codexSessionsDir, base } = fixture()
    const result = await scanTranscripts({
      projectsDir,
      codexSessionsDir,
      maxFilesPerRoot: 10,
      repoRoots: ['/repo'],
      classifyFailure: claim,
      tempRoot: base,
    })
    expect(result.claudeEscalations).toEqual([{ source: 'claude', command: 'pnpm install' }])
    expect(result.claudeDenials).toEqual([
      { source: 'claude', kind: 'user-rejected', command: 'rm -rf /' },
    ])
    expect(result.claudeSandboxFailures.map((record) => record.kind)).toEqual([
      'write-path',
      'genuine',
    ])
    expect(result.codexSandboxFailures).toMatchObject([
      { kind: 'write-path', command: 'git fetch' },
    ])
    expect(result).toMatchObject({ claudeFilesScanned: 1, codexFilesScanned: 1, readErrors: [] })
    expect(result.repoRoots).toEqual(['/repo'])
  })

  it('applies the default temp root and no custom rule', async () => {
    const { projectsDir, codexSessionsDir } = fixture()
    const result = await scanTranscripts({
      projectsDir,
      codexSessionsDir,
      maxFilesPerRoot: 10,
      repoRoots: ['/repo'],
    })
    expect(result.claudeSandboxFailures.map((record) => record.kind)).toEqual(['genuine'])
    expect(result.codexSandboxFailures).toEqual([])
  })

  it('records unreadable files as read errors and keeps going', async () => {
    const base = tempDir()
    const projectsDir = join(base, 'projects')
    const codexSessionsDir = join(base, 'sessions')
    const huge = JSON.stringify({ cwd: '/repo', pad: 'x'.repeat(2.1 * 1024 * 1024) })
    const claudeBad = writeLines(join(projectsDir, 'p', 'a.jsonl'), [JSON.stringify(cwdRecord)])
    writeLines(join(projectsDir, 'p', 'b.jsonl'), [huge])
    const codexBad = writeLines(join(codexSessionsDir, 'rollout-1-x.jsonl'), [huge])
    const result = await scanTranscripts({
      projectsDir,
      codexSessionsDir,
      maxFilesPerRoot: 10,
      repoRoots: [],
    })
    expect(result.claudeFilesScanned).toBe(1)
    expect(result.readErrors).toHaveLength(2)
    expect(result.readErrors.join('\n')).toContain('exceeds 2097152 byte limit')
    expect(result.readErrors.join('\n')).toContain(codexBad)
    expect(claudeBad).toBeTruthy()
  })

  it('records a transcript that cannot be opened as a read error', async () => {
    const base = tempDir()
    const projectsDir = join(base, 'projects')
    const codexSessionsDir = join(base, 'sessions')
    const claude = writeLines(join(projectsDir, 'p', 'a.jsonl'), jsonl(cwdRecord))
    const codex = writeLines(join(codexSessionsDir, 'rollout-1-x.jsonl'), jsonl(meta))
    chmodSync(claude, 0o000)
    chmodSync(codex, 0o000)
    const result = await scanTranscripts({
      projectsDir,
      codexSessionsDir,
      maxFilesPerRoot: 10,
      repoRoots: [],
    })
    chmodSync(claude, 0o600)
    chmodSync(codex, 0o600)
    expect(result.readErrors).toHaveLength(2)
    expect(result.readErrors.join('\n')).toContain('EACCES')
    expect(result.claudeFilesScanned + result.codexFilesScanned).toBe(0)
  })

  it('carries per-file retention into the totals and bounds the whole result', async () => {
    const base = tempDir()
    const projectsDir = join(base, 'projects')
    writeLines(
      join(projectsDir, 'p', 'a.jsonl'),
      jsonl(
        cwdRecord,
        bashUse('1', 'abcdefghij', { dangerouslyDisableSandbox: true }),
        bashUse('2', 'b', { dangerouslyDisableSandbox: true }),
      ),
    )
    const result = await scanTranscripts({
      projectsDir,
      codexSessionsDir: join(base, 'sessions'),
      maxFilesPerRoot: 10,
      repoRoots: [],
      limits: { maxRetainedRawTextChars: 4, maxRetainedRecords: 1 },
    })
    expect(result.claudeEscalations).toHaveLength(1)
    expect(result.rawRetention).toMatchObject({ commandTextsTruncated: 1, recordsDropped: 1 })
  })
})
