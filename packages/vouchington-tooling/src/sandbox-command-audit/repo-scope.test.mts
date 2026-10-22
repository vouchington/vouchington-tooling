import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from './fixtures.test-helpers.mts'
import { isWithinRepoRoots, resolveRepoRoots } from './repo-scope.mts'

function realRepo() {
  const root = realpathSync(tempDir())
  const main = join(root, 'main')
  const sibling = join(root, 'sibling')
  const run = (...args: string[]) => execFileSync('git', args, { cwd: main, stdio: 'ignore' })
  mkdirSync(main)
  run('init', '-q')
  run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  run('worktree', 'add', '-q', '--detach', sibling)
  return { main, sibling, nested: join(main, 'sub') }
}

describe('resolveRepoRoots with git', () => {
  it('asks git for the main checkout and every linked worktree', async () => {
    const { main, sibling } = realRepo()
    expect((await resolveRepoRoots(main)).toSorted()).toEqual([main, sibling].toSorted())
    expect((await resolveRepoRoots(sibling)).toSorted()).toEqual([main, sibling].toSorted())
  })

  it('keeps a worktree whose directory was deleted, since it can own past transcripts', async () => {
    const { main, sibling } = realRepo()
    rmSync(sibling, { recursive: true })
    expect((await resolveRepoRoots(main)).toSorted()).toEqual([main, sibling].toSorted())
  })

  it('roots a submodule at its checkout, not at the parent of its metadata directory', async () => {
    const { main } = realRepo()
    const module = join(realpathSync(tempDir()), 'module')
    const run = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'protocol.file.allow=always', ...args], { cwd, stdio: 'ignore' })
    mkdirSync(module)
    run(module, 'init', '-q')
    run(
      module,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'i',
    )
    run(main, 'submodule', 'add', '-q', module, 'sub')
    const checkout = join(main, 'sub')
    const roots = await resolveRepoRoots(checkout)
    expect(roots).toEqual([checkout])
    expect(await isWithinRepoRoots(join(main, '.git', 'modules'), roots)).toBe(false)
  })

  it('rejects outside a repository', async () => {
    await expect(resolveRepoRoots(realpathSync(tempDir()))).rejects.toThrow()
  })
})

describe('resolveRepoRoots with injected git', () => {
  const deps = {
    gitToplevel: async () => '/repo',
    gitWorktreePaths: async () => ['/repo', '/repo/.claude/worktrees/a', '/elsewhere/wt'],
  }

  it('unions the checkout with its worktrees and drops roots nested in another', async () => {
    expect(await resolveRepoRoots('/repo', { deps })).toEqual(['/repo', '/elsewhere/wt'])
  })

  it('uses explicit roots without calling git, resolving relative ones against cwd', async () => {
    const calls: string[] = []
    const guarded = {
      gitToplevel: async () => (calls.push('top'), ''),
      gitWorktreePaths: async () => (calls.push('list'), []),
    }
    const roots = await resolveRepoRoots('/base', {
      explicit: ['rel', '/base/rel/inner', '/abs'],
      deps: guarded,
    })
    expect(roots).toEqual(['/base/rel', '/abs'])
    expect(calls).toEqual([])
  })

  it('falls through to git when the explicit list is empty', async () => {
    expect(await resolveRepoRoots('/repo', { explicit: [], deps })).toEqual([
      '/repo',
      '/elsewhere/wt',
    ])
  })

  it('adds the matches of worktree globs, relative to each root', async () => {
    const base = realpathSync(tempDir())
    mkdirSync(join(base, 'checkouts', 'one'), { recursive: true })
    mkdirSync(join(base, 'checkouts', 'two'))
    const roots = await resolveRepoRoots(base, {
      explicit: [join(base, 'main')],
      worktreeGlobs: ['../checkouts/*'],
    })
    expect(roots.toSorted()).toEqual(
      [
        join(base, 'main'),
        join(base, 'checkouts', 'one'),
        join(base, 'checkouts', 'two'),
      ].toSorted(),
    )
  })

  it('ignores a glob that matches nothing', async () => {
    expect(await resolveRepoRoots('/repo', { deps, worktreeGlobs: ['nope/*'] })).toEqual([
      '/repo',
      '/elsewhere/wt',
    ])
  })
})

describe('isWithinRepoRoots', () => {
  it('matches the root and paths below it, never a string-prefix sibling', async () => {
    const roots = ['/repo']
    expect(await isWithinRepoRoots('/repo', roots)).toBe(true)
    expect(await isWithinRepoRoots('/repo/a/b', roots)).toBe(true)
    expect(await isWithinRepoRoots('/repo-two', roots)).toBe(false)
    expect(await isWithinRepoRoots('/other', roots)).toBe(false)
    expect(await isWithinRepoRoots('/repo/x', ['/'])).toBe(true)
  })

  it('canonicalizes a symlinked cwd before comparing', async () => {
    const base = realpathSync(tempDir())
    mkdirSync(join(base, 'real'))
    symlinkSync(join(base, 'real'), join(base, 'link'))
    expect(await isWithinRepoRoots(join(base, 'link'), [join(base, 'real')])).toBe(true)
  })
})
