import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
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
  it('finds a details block with nested details, and fails closed on an unterminated one', () => {
    expect(findShepherdJournal(`intro\n\n${DETAILS}\ntail`)).toBe(DETAILS)
    expect(() => findShepherdJournal('<details>\n<summary>Shepherd Journal</summary>\nx')).toThrow(
      'never closed',
    )
  })

  it('tracks nesting outside fences, needs a real H2 and a bare closing fence', () => {
    const fenced = '<details>\n<summary>Shepherd Journal</summary>\n```\n<details>\n```\n</details>'
    expect(findShepherdJournal(fenced)).toBe(fenced)
    expect(findShepherdJournal('## Shepherd Journal\nx\n##not-a-heading\ny')).toBe(
      '## Shepherd Journal\nx\n##not-a-heading\ny',
    )
    for (const heading of ['  ## Shepherd Journal', '## Shepherd Journal ##'])
      expect(findShepherdJournal(`a\n${heading}\nx\n ## Next`)).toBe(`${heading}\nx`)
    // "```js" inside a fence does not close it, so the journal-shaped line stays hidden.
    expect(findShepherdJournal('```\n```js\n## Shepherd Journal\n```')).toBeUndefined()
  })

  it('refuses to append the journal after a code fence the fields left open', () => {
    expect(() => preserveShepherdJournal('new\n```\ncode', '## Shepherd Journal\nz')).toThrow(
      'leave a code fence open',
    )
  })

  it('finds a legacy section to the next H2 or the end', () => {
    expect(findShepherdJournal('a\n## Shepherd Journal\nx\n### sub\n\n## Next\ny')).toBe(
      '## Shepherd Journal\nx\n### sub',
    )
    expect(findShepherdJournal('a\r\n## Shepherd Journal\r\nx\r\n')).toBe('## Shepherd Journal\nx')
    expect(findShepherdJournal('nothing')).toBeUndefined()
  })

  it('appends the live journal, and rejects rendered fields that carry their own', () => {
    expect(preserveShepherdJournal('new\n', `old\n${DETAILS}\n`)).toBe(`new\n\n${DETAILS}\n`)
    expect(preserveShepherdJournal('new\n', 'old')).toBe('new\n')
    expect(() => preserveShepherdJournal(`new\n${DETAILS}\n`, '## Shepherd Journal\nz')).toThrow(
      'the pull request fields contain a Shepherd Journal',
    )
  })

  it('ignores examples in fenced code and fails closed on more than one journal', () => {
    const example = (fence: string) => `${fence}md\n## Shepherd Journal\nfake\n${fence}`
    const body = `${example('```')}\n${example('~~~~')}\n\n${DETAILS}\n`
    expect(findShepherdJournal(body)).toBe(DETAILS)
    expect(preserveShepherdJournal(`new\n${example('```')}\n`, body)).toBe(
      `new\n${example('```')}\n\n${DETAILS}\n`,
    )
    expect(findShepherdJournal('## Shepherd Journal\nx\n```\n## not a heading\n```\ny')).toBe(
      '## Shepherd Journal\nx\n```\n## not a heading\n```\ny',
    )
    expect(findShepherdJournal('```\nunterminated\n## Shepherd Journal\n')).toBeUndefined()
    expect(() => findShepherdJournal(`${DETAILS}\n\n## Shepherd Journal\nx`)).toThrow(
      'more than one Shepherd Journal',
    )
  })
})

describe('gh access', () => {
  it('drops blackboard credentials and GH_REPO from the environment', () => {
    expect(
      ghEnvironment({
        A: '1',
        AGENT_BLACKBOARD_URL: 'u',
        AGENT_BLACKBOARD_TOKEN: 't',
        GH_REPO: 'o/r',
      }),
    ).toEqual({ A: '1' })
  })

  it('drops CLICOLOR_FORCE so gh --json output stays uncolored', () => {
    expect(ghEnvironment({ A: '1', CLICOLOR_FORCE: '1', NO_COLOR: '1' })).toEqual({
      A: '1',
      NO_COLOR: '1',
    })
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
      // A relative entry is never trusted, even when it names a real gh.
      await expect(locateGh({ PATH: relative(process.cwd(), bin) }, [])).rejects.toThrow(
        'gh CLI not found',
      )
      const run = createGhRunner({ PATH: bin })
      expect((await run(['pr', 'view'], { cwd: root, env: {} })).trim()).toBe('pr view')
      expect((await run(['again'], { cwd: root, env: {} })).trim()).toBe('again')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to an absolute location when PATH has no gh', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vouchington-gh-'))
    try {
      const fallback = join(root, 'gh')
      writeFileSync(fallback, '#!/bin/sh\n')
      chmodSync(fallback, 0o755)
      expect(await locateGh({ PATH: join(root, 'missing') }, [join(root, 'nope'), fallback])).toBe(
        fallback,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips non-executable and missing candidates, else fails with the install hint', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vouchington-gh-'))
    try {
      const plain = join(root, 'gh')
      writeFileSync(plain, 'not executable')
      chmodSync(plain, 0o644)
      await expect(locateGh({ PATH: root }, [join(root, 'absent')])).rejects.toThrow(
        "gh CLI not found on PATH; install gh or add it to the server's PATH",
      )
      await expect(locateGh({}, [])).rejects.toThrow('gh CLI not found on PATH')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
