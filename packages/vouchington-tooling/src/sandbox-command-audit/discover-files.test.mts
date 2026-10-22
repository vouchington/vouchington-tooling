import { symlinkSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverTranscriptFiles, selectInRepo } from './discover-files.mts'
import { tempDir, writeLines } from './fixtures.test-helpers.mts'

const ID = '11111111-2222-3333-4444-555555555555'
const OTHER_ID = '11111111-2222-3333-4444-5555555555ff'
const cwdLine = (cwd: string) => JSON.stringify({ type: 'user', cwd })
const sessionMeta = (cwd: string) => JSON.stringify({ type: 'session_meta', payload: { cwd } })

function touch(path: string, ageDays: number, now: number): string {
  const seconds = (now - ageDays * 86_400_000) / 1000
  utimesSync(path, seconds, seconds)
  return path
}

function layout() {
  const base = tempDir()
  const projectsDir = join(base, 'projects')
  const codexSessionsDir = join(base, 'sessions')
  const now = Date.now()
  const paths = {
    mine: touch(writeLines(join(projectsDir, 'mine', 'a.jsonl'), [cwdLine('/repo/sub')]), 1, now),
    mineOld: touch(writeLines(join(projectsDir, 'mine', 'old.jsonl'), [cwdLine('/repo')]), 40, now),
    subagent: touch(
      writeLines(join(projectsDir, 'mine', 'a', 'subagents', 'agent-1.jsonl'), ['{"type":"x"}']),
      2,
      now,
    ),
    other: touch(
      writeLines(join(projectsDir, 'other', 'b.jsonl'), [cwdLine('/elsewhere')]),
      0.5,
      now,
    ),
    unknown: touch(writeLines(join(projectsDir, 'unknown', 'c.jsonl'), ['{"type":"x"}']), 3, now),
    codexMine: touch(
      writeLines(join(codexSessionsDir, '2026', 'rollout-1-x.jsonl'), [sessionMeta('/repo')]),
      1,
      now,
    ),
    codexOther: touch(
      writeLines(join(codexSessionsDir, '2026', 'rollout-2-y.jsonl'), [sessionMeta('/nope')]),
      0.2,
      now,
    ),
    codexBroken: touch(
      writeLines(join(codexSessionsDir, '2026', 'rollout-3-z.jsonl'), ['{"x":1}\n'.repeat(1)]),
      2,
      now,
    ),
  }
  return { projectsDir, codexSessionsDir, now, paths }
}

describe('discoverTranscriptFiles', () => {
  it('scopes both roots to the repository and counts what it skips', async () => {
    const { projectsDir, codexSessionsDir, now, paths } = layout()
    const found = await discoverTranscriptFiles({
      projectsDir,
      codexSessionsDir,
      maxFilesPerRoot: 50,
      now,
      repoRoots: ['/repo'],
    })
    expect(found.claudeFiles.toSorted()).toEqual(
      [paths.mine, paths.mineOld, paths.subagent].toSorted(),
    )
    expect(found.codexFiles).toEqual([paths.codexMine])
    expect(found.skippedOtherRepo).toEqual({ claude: 1, codex: 1 })
    expect(found.skippedUnknownCwd).toEqual({ claude: 1, codex: 1 })
  })

  it('applies the day window and then the cap, newest first, after scoping', async () => {
    const { projectsDir, codexSessionsDir, now, paths } = layout()
    const options = { projectsDir, codexSessionsDir, now, repoRoots: ['/repo'] }
    const windowed = await discoverTranscriptFiles({
      ...options,
      maxFilesPerRoot: 50,
      sinceDays: 7,
    })
    expect(windowed.claudeFiles).toEqual([paths.mine, paths.subagent])
    const capped = await discoverTranscriptFiles({ ...options, maxFilesPerRoot: 1 })
    expect(capped.claudeFiles).toEqual([paths.mine])
  })

  it('is purely mtime-ordered and uncounted when no roots are given', async () => {
    const { projectsDir, codexSessionsDir, now, paths } = layout()
    const found = await discoverTranscriptFiles({
      projectsDir,
      codexSessionsDir,
      maxFilesPerRoot: 2,
      now,
      repoRoots: [],
    })
    expect(found.claudeFiles).toEqual([paths.other, paths.mine])
    expect(found.skippedOtherRepo).toEqual({ claude: 0, codex: 0 })
  })

  it('narrows to one session, including its subagents, and bypasses repo scoping', async () => {
    const base = tempDir()
    const projectsDir = join(base, 'projects')
    const codexSessionsDir = join(base, 'sessions')
    const top = writeLines(join(projectsDir, 'p', `${ID}.jsonl`), ['{"type":"x"}'])
    const sub = writeLines(join(projectsDir, 'p', ID, 'subagents', 'agent-1.jsonl'), [
      '{"type":"x"}',
    ])
    writeLines(join(projectsDir, 'p', `${OTHER_ID}.jsonl`), ['{"type":"x"}'])
    const codex = writeLines(join(codexSessionsDir, 'd', `rollout-9-${ID}.jsonl`), ['{"type":"x"}'])
    writeLines(join(codexSessionsDir, 'd', `rollout-9-${OTHER_ID}.jsonl`), ['{"type":"x"}'])
    const found = await discoverTranscriptFiles({
      projectsDir,
      codexSessionsDir,
      maxFilesPerRoot: 50,
      sessionId: ID,
      repoRoots: ['/repo'],
    })
    expect(found.claudeFiles.toSorted()).toEqual([top, sub].toSorted())
    expect(found.codexFiles).toEqual([codex])
    expect(found.skippedUnknownCwd).toEqual({ claude: 0, codex: 0 })
  })

  it('skips a transcript that disappears or cannot be statted', async () => {
    const base = tempDir()
    const projectsDir = join(base, 'projects')
    writeLines(join(projectsDir, 'p', 'a.jsonl'), ['{"type":"x"}'])
    symlinkSync(join(base, 'gone'), join(projectsDir, 'p', 'dangling.jsonl'))
    const found = await discoverTranscriptFiles({
      projectsDir,
      codexSessionsDir: join(base, 'sessions'),
      maxFilesPerRoot: 50,
      repoRoots: [],
    })
    expect(found.claudeFiles).toEqual([join(projectsDir, 'p', 'a.jsonl')])
  })
})

describe('selectInRepo', () => {
  const entry = (path: string) => ({ path, mtimeMs: 0 })

  it('counts a cwd resolver that throws as unknown, and stops at the limit', async () => {
    const result = await selectInRepo(
      [entry('boom'), entry('in'), entry('out'), entry('in2'), entry('never')],
      2,
      ['/repo'],
      async (path) => {
        if (path === 'boom') throw new Error('unreadable')
        return path.startsWith('in') ? '/repo' : '/elsewhere'
      },
    )
    expect(result).toEqual({ files: ['in', 'in2'], skippedOtherRepo: 1, skippedUnknownCwd: 1 })
  })
})
