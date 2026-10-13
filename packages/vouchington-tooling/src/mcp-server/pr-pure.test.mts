import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { worktreeLabel } from './pr-body.mts'
import { createGhRunner, ghEnvironment, locateGh } from './pr-gh.mts'
import { findShepherdJournal, preserveShepherdJournal } from './pr-journal.mts'

const DETAILS =
  '<details>\n<summary>Shepherd Journal</summary>\n\n<details>\nnested\n</details>\n\n</details>'

describe('worktreeLabel', () => {
  it('prefers the path after /worktrees/, then main, then the basename', () => {
    expect(worktreeLabel('/r/.claude/worktrees/a/b', '/r')).toBe('a/b')
    expect(worktreeLabel('/r', '/r')).toBe('main')
    expect(worktreeLabel('/x/other', '/r')).toBe('other')
    expect(worktreeLabel('/x/other', undefined)).toBe('other')
  })
})

describe('Shepherd Journal', () => {
  it('finds a details block with nested details, and an unterminated one is ignored', () => {
    expect(findShepherdJournal(`intro\n\n${DETAILS}\ntail`)).toBe(DETAILS)
    expect(findShepherdJournal('<details>\n<summary>Shepherd Journal</summary>\nx')).toBeUndefined()
  })

  it('finds a legacy section to the next H2 or the end', () => {
    expect(findShepherdJournal('a\n## Shepherd Journal\nx\n### sub\n\n## Next\ny')).toBe(
      '## Shepherd Journal\nx\n### sub',
    )
    expect(findShepherdJournal('a\r\n## Shepherd Journal\r\nx\r\n')).toBe('## Shepherd Journal\nx')
    expect(findShepherdJournal('nothing')).toBeUndefined()
  })

  it('appends the live journal only when the rendered body has none', () => {
    expect(preserveShepherdJournal('new\n', `old\n${DETAILS}\n`)).toBe(`new\n\n${DETAILS}\n`)
    expect(preserveShepherdJournal('new\n', 'old')).toBe('new\n')
    const own = `new\n${DETAILS}\n`
    expect(preserveShepherdJournal(own, '## Shepherd Journal\nz')).toBe(own)
  })
})

describe('gh access', () => {
  it('drops blackboard credentials from the environment', () => {
    expect(
      ghEnvironment({ A: '1', AGENT_BLACKBOARD_URL: 'u', AGENT_BLACKBOARD_TOKEN: 't' }),
    ).toEqual({ A: '1' })
  })

  it('locates gh on PATH, skipping directories, and runs it once located', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vouchington-gh-'))
    try {
      const bin = join(root, 'bin')
      const dirGh = join(root, 'dirgh')
      mkdirSync(join(dirGh, 'gh'), { recursive: true })
      mkdirSync(bin)
      const gh = join(bin, 'gh')
      writeFileSync(gh, '#!/bin/sh\necho "$@"\n')
      chmodSync(gh, 0o755)
      expect(await locateGh({ PATH: `${dirGh}:${bin}` })).toBe(gh)
      const run = createGhRunner({ PATH: bin })
      expect((await run(['pr', 'view'], { cwd: root, env: {} })).trim()).toBe('pr view')
      expect((await run(['again'], { cwd: root, env: {} })).trim()).toBe('again')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to absolute locations, else fails with the install hint', async () => {
    const attempt = await locateGh({}).catch((error: Error) => error)
    if (attempt instanceof Error)
      expect(attempt.message).toBe(
        "gh CLI not found on PATH; install gh or add it to the server's PATH",
      )
    else expect(attempt).toMatch(/\/gh$/)
  })
})
