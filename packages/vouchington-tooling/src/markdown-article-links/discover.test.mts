import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { discoverMarkdownArticles, gitLsFiles } from './index.mts'

const roots: string[] = []

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function tempRepo(files: Record<string, string>, untracked: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'article-links-'))
  roots.push(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'user.name', 'Test')
  const write = (set: Record<string, string>) => {
    for (const [path, content] of Object.entries(set)) {
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(join(root, path), content)
    }
  }
  write(files)
  git(root, 'add', '.')
  write(untracked)
  return root
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('discoverMarkdownArticles', () => {
  const repo = tempRepo(
    {
      'b.md': 'bee',
      'a.md': 'ay',
      'README.md': 'readme',
      'notes.txt': 'not markdown',
      'nested/deep.md': 'nested',
    },
    { 'untracked.md': 'untracked' },
  )

  it('returns sorted tracked top-level markdown, skipping README, nested and untracked files', async () => {
    expect(await discoverMarkdownArticles(repo)).toEqual([
      { name: 'a.md', source: 'ay' },
      { name: 'b.md', source: 'bee' },
    ])
  })

  it('accepts configurable exclusions, replacing the README default', async () => {
    expect(await discoverMarkdownArticles(repo, { exclude: ['a.md'] })).toEqual([
      { name: 'README.md', source: 'readme' },
      { name: 'b.md', source: 'bee' },
    ])
  })

  it('lists a subdirectory root directly, without its parent or children', async () => {
    const nested = join(repo, 'nested')
    expect(await discoverMarkdownArticles(nested)).toEqual([{ name: 'deep.md', source: 'nested' }])
  })

  it('throws on empty discovery by default', async () => {
    const empty = tempRepo({ 'README.md': 'only readme', 'sub/x.md': 'nested' })
    await expect(discoverMarkdownArticles(empty)).rejects.toThrow(
      `No git-tracked markdown articles found directly under ${empty}`,
    )
  })

  it('returns an empty list when allowEmpty opts out', async () => {
    const empty = tempRepo({ 'README.md': 'only readme' })
    expect(await discoverMarkdownArticles(empty, { allowEmpty: true })).toEqual([])
  })

  it('uses an injected runner for tracked paths', async () => {
    const seen: string[] = []
    const found = await discoverMarkdownArticles(repo, {
      listTrackedFiles: async (root) => {
        seen.push(root)
        return ['b.md', 'a.md', 'dir/c.md', 'image.png']
      },
    })
    expect(seen).toEqual([repo])
    expect(found.map((input) => input.name)).toEqual(['a.md', 'b.md'])
  })

  it('does not sort by locale or case-fold', async () => {
    const root = mkdtempSync(join(tmpdir(), 'article-links-sort-'))
    roots.push(root)
    for (const name of ['a.md', 'B.md', 'c.md']) writeFileSync(join(root, name), name)
    const found = await discoverMarkdownArticles(root, {
      listTrackedFiles: async () => ['c.md', 'a.md', 'B.md'],
    })
    expect(found.map((input) => input.name)).toEqual(['B.md', 'a.md', 'c.md'])
  })
})

describe('gitLsFiles', () => {
  it('lists only tracked markdown paths relative to the root', async () => {
    const repo = tempRepo({ 'x.md': '1', 'y.txt': '2', 'd/z.md': '3' }, { 'u.md': '4' })
    expect((await gitLsFiles(repo)).sort()).toEqual(['d/z.md', 'x.md'])
  })

  it('rejects outside a git repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'article-links-plain-'))
    roots.push(plain)
    await expect(gitLsFiles(plain)).rejects.toThrow()
  })
})
