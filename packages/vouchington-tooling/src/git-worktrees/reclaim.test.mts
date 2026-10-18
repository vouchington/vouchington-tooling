import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { parseWorktreeList } from './list.mts'
import { formatReport, reclaimWorktrees } from './reclaim.mts'
import { createFixture, type Fixture } from './reclaim.test-helpers.mts'

let fx: Fixture

beforeEach(() => {
  fx = createFixture()
})
afterEach(() => {
  fx.cleanup()
})

const merged = { state: 'MERGED' }

function reclaim(yes = false, env: NodeJS.ProcessEnv = fx.env, cwd = fx.caller) {
  return reclaimWorktrees(yes, { cwd, env })
}

function summary(report: ReturnType<typeof reclaim>) {
  return report.worktrees
    .map((e) => [e.branch, e.status, e.reason] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))
}

function only(report: ReturnType<typeof reclaim>) {
  expect(report.worktrees).toHaveLength(1)
  return report.worktrees[0]!
}

describe('finished worktrees', () => {
  it.each(['MERGED', 'CLOSED'])(
    'reports a %s PR as reclaimable and changes nothing in a dry run',
    (state) => {
      const path = fx.addWorktree('done', { push: true })
      fx.setPrs('done', [{ state }])
      const entry = only(reclaim())
      expect(entry).toMatchObject({ path, branch: 'done', status: 'would reclaim' })
      expect(existsSync(path)).toBe(true)
      expect(reclaim().dryRun).toBe(true)
    },
  )

  it('removes a finished worktree with --yes and leaves its branch and the others alone', () => {
    const path = fx.addWorktree('done', { push: true })
    const other = fx.addWorktree('busy', { push: true })
    fx.setPrs('done', [merged])
    fx.setPrs('busy', [{ state: 'OPEN' }])
    const report = reclaim(true)
    expect(report.dryRun).toBe(false)
    expect(summary(report)).toEqual([
      ['busy', 'kept', 'open PR'],
      ['done', 'reclaimed', undefined],
    ])
    expect(existsSync(path)).toBe(false)
    expect(existsSync(other)).toBe(true)
    expect(fx.git(fx.main, 'branch', '--list', 'done')).toContain('done')
  })

  it('reclaims a squash-merged branch deleted on the remote when the PR head is HEAD', () => {
    fx.addWorktree('squashed', { push: true })
    fx.git(fx.main, 'push', 'origin', '--delete', 'squashed')
    fx.git(fx.main, 'fetch', '--prune', 'origin')
    fx.setPrs('squashed', [merged])
    expect(only(reclaim(true)).status).toBe('reclaimed')
  })

  it('ignores PR head-repository case when matching this repository', () => {
    fx.addWorktree('done', { push: true })
    fx.setPrs('done', [{ ...merged, headRepositoryOwner: { login: 'ACME' } }])
    expect(only(reclaim()).status).toBe('would reclaim')
  })

  it('strips GH_REPO so the repository comes from the main checkout', () => {
    fx.addWorktree('done', { push: true })
    fx.setPrs('done', [merged])
    expect(
      only(reclaim(false, { ...fx.env, GH_REPO: 'evil/other', GH_HOST: 'x.example' })).status,
    ).toBe('would reclaim')
  })
})

describe('kept worktrees', () => {
  const kept = (reason: string) => expect.objectContaining({ status: 'kept', reason })

  it('keeps a worktree with an open PR, even beside a merged one', () => {
    fx.addWorktree('wip', { push: true })
    fx.setPrs('wip', [merged, { state: 'OPEN' }])
    expect(only(reclaim())).toEqual(kept('open PR'))
  })

  it('keeps a worktree with no PR', () => {
    fx.addWorktree('nopr', { push: true })
    expect(only(reclaim())).toEqual(kept('no finished PR from this repository'))
  })

  it('ignores PRs from forks, even an open one', () => {
    fx.addWorktree('forked', { push: true })
    fx.setPrs('forked', [
      { ...merged, isCrossRepository: true },
      { state: 'OPEN', isCrossRepository: true },
      { ...merged, headRepository: { name: 'Widgets' }, headRepositoryOwner: { login: 'mallory' } },
      { ...merged, headRepository: null, headRepositoryOwner: null },
    ])
    expect(only(reclaim())).toEqual(kept('no finished PR from this repository'))
  })

  it('keeps a worktree whose finished PR head is not HEAD', () => {
    fx.addWorktree('moved', { push: true })
    fx.setPrs('moved', [{ ...merged, headRefOid: 'a'.repeat(40) }])
    expect(only(reclaim())).toEqual(kept('PR head differs from HEAD'))
  })

  it('keeps a worktree with commits newer than the finished PR head', () => {
    const path = fx.addWorktree('local')
    fx.setPrs('local', [merged])
    fx.git(path, 'commit', '--allow-empty', '-m', 'newer')
    expect(only(reclaim())).toEqual(kept('PR head differs from HEAD'))
  })

  it.each([['open'], ['all']])('keeps a worktree when the %s PR query fills its page', (state) => {
    fx.addWorktree('busy', { push: true })
    fx.setPrs('busy', [merged])
    const env = { ...fx.env, [`FAKE_GH_PAD_${state.toUpperCase()}`]: '1000' }
    expect(only(reclaim(false, env))).toEqual(kept('cannot read PR state'))
  })

  it('keeps a worktree with untracked files, including inside new directories', () => {
    const path = fx.addWorktree('dirty', { push: true })
    fx.setPrs('dirty', [merged])
    mkdirSync(join(path, 'new'))
    writeFileSync(join(path, 'new', 'file.txt'), 'x')
    expect(only(reclaim())).toEqual(kept('uncommitted changes'))
  })

  it('keeps a worktree with modified tracked files', () => {
    const path = fx.addWorktree('edited', { push: true })
    fx.setPrs('edited', [merged])
    writeFileSync(join(path, 'edited.txt'), 'changed\n')
    expect(only(reclaim())).toEqual(kept('uncommitted changes'))
  })

  it.each(['--assume-unchanged', '--skip-worktree'])(
    'keeps a worktree hiding edits with %s',
    (flag) => {
      const path = fx.addWorktree('hidden', { push: true })
      fx.setPrs('hidden', [merged])
      fx.git(path, 'update-index', flag, 'hidden.txt')
      writeFileSync(join(path, 'hidden.txt'), 'secret edit\n')
      expect(only(reclaim()).reason).toMatch(/^hidden index entries/)
    },
  )

  it('never executes core.fsmonitor from the repository config', () => {
    const path = fx.addWorktree('monitor', { push: true })
    fx.setPrs('monitor', [merged])
    const marker = join(fx.root, 'fsmonitor-ran')
    const hook = join(fx.root, 'fsmonitor.sh')
    writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`)
    chmodSync(hook, 0o755)
    fx.git(path, 'config', 'core.fsmonitor', hook)
    expect(only(reclaim(true)).status).toBe('reclaimed')
    expect(existsSync(marker)).toBe(false)
  })

  it('keeps everything when gh fails or answers garbage', () => {
    fx.addWorktree('done', { push: true })
    fx.setPrs('done', [merged])
    expect(only(reclaim(false, { ...fx.env, FAKE_GH_FAIL: '1' })).reason).toBe(
      'cannot read repository',
    )
    expect(only(reclaim(false, { ...fx.env, FAKE_GH_GARBAGE: '1' })).reason).toBe(
      'cannot read PR state',
    )
  })

  it.each([
    ['status --porcelain', 'cannot read status'],
    ['ls-files -v', 'cannot read index'],
    ['rev-parse HEAD', 'cannot read HEAD'],
  ])('keeps a worktree when git %s fails', (command, reason) => {
    fx.addWorktree('flaky', { push: true })
    fx.setPrs('flaky', [merged])
    const env = { ...fx.env, FAKE_GIT_FAIL: command }
    expect(only(reclaim(false, env)).reason).toBe(reason)
  })
})

describe('skipped worktrees', () => {
  it('skips the main checkout, the caller, locked, detached and missing worktrees', () => {
    fx.addWorktree('locked', { push: true })
    fx.git(fx.main, 'worktree', 'lock', join(fx.root, 'worktrees', 'locked'))
    const detached = fx.addWorktree('detached', { push: true })
    fx.git(detached, 'checkout', '--detach')
    const missing = fx.addWorktree('missing', { push: true })
    rmSync(missing, { recursive: true })
    for (const branch of ['locked', 'caller', 'main']) fx.setPrs(branch, [merged])
    expect(reclaim().worktrees).toEqual([])
    // From the main checkout the caller worktree is an ordinary candidate; main itself is skipped.
    expect(reclaim(false, fx.env, fx.main).worktrees.map((e) => e.branch)).toEqual(['caller'])
  })

  it('matches the caller through a symlinked path', () => {
    fx.setPrs('caller', [merged])
    const link = join(fx.root, 'link')
    symlinkSync(fx.caller, link)
    expect(reclaim(true, fx.env, link).worktrees).toEqual([])
    expect(existsSync(fx.caller)).toBe(true)
  })

  it('fails outside a repository', () => {
    expect(() => reclaim(false, fx.env, fx.root)).toThrow('not inside a git worktree')
  })
})

describe('applying', () => {
  it('reports git refusing to remove a worktree and carries on', () => {
    const path = fx.addWorktree('stuck', { push: true })
    const other = fx.addWorktree('free', { push: true })
    fx.setPrs('stuck', [merged])
    fx.setPrs('free', [merged])
    // An ignored file in a read-only directory passes the checks but cannot be deleted.
    fx.git(fx.main, 'config', '--local', 'core.excludesFile', join(fx.root, 'ignore'))
    writeFileSync(join(fx.root, 'ignore'), 'locked-dir/\n')
    mkdirSync(join(path, 'locked-dir'))
    writeFileSync(join(path, 'locked-dir', 'file'), 'x')
    chmodSync(join(path, 'locked-dir'), 0o500)
    try {
      const report = reclaim(true)
      expect(summary(report)).toEqual([
        ['free', 'reclaimed', undefined],
        ['stuck', 'kept', 'git worktree remove refused'],
      ])
      expect(existsSync(path)).toBe(true)
      expect(existsSync(other)).toBe(false)
    } finally {
      chmodSync(join(path, 'locked-dir'), 0o700)
    }
  })

  it('keeps a worktree that becomes dirty before removal', () => {
    const path = fx.addWorktree('racy', { push: true })
    fx.setPrs('racy', [merged])
    const entry = only(reclaim(true, { ...fx.env, FAKE_GH_TOUCH: join(path, 'late.txt') }))
    expect(entry).toMatchObject({ status: 'kept', reason: 'changed since check' })
    expect(existsSync(path)).toBe(true)
  })

  it('keeps a worktree whose HEAD moves before removal', () => {
    const path = fx.addWorktree('moving', { push: true })
    fx.setPrs('moving', [merged])
    const entry = only(reclaim(true, { ...fx.env, FAKE_GH_ADVANCE: path }))
    expect(entry).toMatchObject({ status: 'kept', reason: 'changed since check' })
    expect(existsSync(path)).toBe(true)
  })

  it('keeps a worktree switched to another branch at the same commit', () => {
    const path = fx.addWorktree('switchy', { push: true })
    fx.setPrs('switchy', [merged])
    const entry = only(reclaim(true, { ...fx.env, FAKE_GH_SWITCH: path }))
    expect(entry).toMatchObject({ status: 'kept', reason: 'changed since check' })
    expect(existsSync(path)).toBe(true)
  })
})

describe('inherited git environment', () => {
  it('lets cwd choose the repository even when GIT_DIR and GIT_WORK_TREE point elsewhere', () => {
    const other = fx.addWorktree('other', { push: true })
    fx.setPrs('other', [merged])
    const env = {
      ...fx.env,
      GIT_DIR: join(fx.main, '.git'),
      GIT_WORK_TREE: fx.main,
      GIT_INDEX_FILE: join(fx.main, '.git', 'index'),
    }
    const report = reclaim(true, env)
    expect(report.worktrees.map((e) => [e.path, e.status])).toEqual([[other, 'reclaimed']])
    expect(existsSync(fx.caller)).toBe(true)
  })
})

describe('paths', () => {
  it('keeps path whitespace intact for the caller and candidates', () => {
    const spaced = fx.addWorktree('spaced', { push: true, dir: 'spaced ' })
    const other = fx.addWorktree('other', { push: true, dir: 'other ' })
    fx.setPrs('spaced', [merged])
    fx.setPrs('other', [merged])
    const report = reclaim(true, fx.env, spaced)
    expect(report.worktrees.map((e) => [e.path, e.status])).toContainEqual([other, 'reclaimed'])
    expect(report.worktrees.map((e) => e.branch)).not.toContain('spaced')
    expect(existsSync(spaced)).toBe(true)
  })
})

describe('parseWorktreeList and formatReport', () => {
  it('parses NUL-separated records, locks, bare and detached entries', () => {
    const text = [
      'worktree /a\nb',
      'HEAD 1',
      'branch refs/heads/x',
      '',
      'worktree /locked',
      'locked why',
      'detached',
      '',
      'junk',
      '',
      'worktree /bare',
      'bare',
      'locked',
      '',
    ].join('\0')
    expect(parseWorktreeList(text)).toEqual([
      { path: '/a\nb', branch: 'x', locked: false, bare: false, detached: false },
      { path: '/locked', locked: true, bare: false, detached: true },
      { path: '/bare', locked: true, bare: true, detached: false },
    ])
  })

  it('prints one line per worktree with control characters escaped', () => {
    const text = formatReport({
      dryRun: true,
      worktrees: [
        { path: '/a\nb\u001b[31m', branch: 'x', status: 'would reclaim' },
        { path: '/c', branch: 'y', status: 'kept', reason: 'open PR' },
        { path: '/d', branch: 'z', status: 'reclaimed' },
      ],
    })
    expect(text).toBe('/a\\x0ab\\x1b[31m: would reclaim\n/c: kept: open PR\n/d: reclaimed\n')
  })
})
