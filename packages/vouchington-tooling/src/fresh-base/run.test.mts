import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkFreshBase } from './index.mts'
import type { GitResult, GitRunner } from './index.mts'

interface Script {
  fetch?: number
  branch?: string
  status?: GitResult
  ref?: number
  counts?: GitResult
  repo?: number
}

function fakeGit(script: Script, calls: string[][] = []): GitRunner {
  return (args, _cwd, timeout) => {
    calls.push([...args, ...(timeout === undefined ? [] : [`timeout=${timeout}`])])
    const ok = { status: 0, stdout: '' }
    switch (args[0]) {
      case 'rev-parse':
        if (args[1] === '--git-dir') return { status: script.repo ?? 0, stdout: '' }
        return { status: script.ref ?? 0, stdout: '' }
      case 'fetch':
        return { status: script.fetch ?? 0, stdout: '' }
      case 'branch':
        return { status: 0, stdout: script.branch ?? 'feat/x\n' }
      case 'status':
        return script.status ?? ok
      default:
        return script.counts ?? { status: 0, stdout: '0\t0\n' }
    }
  }
}

describe('checkFreshBase', () => {
  it('fetches the base with a timeout and reports an up-to-date worktree', () => {
    const calls: string[][] = []
    const report = checkFreshBase({ git: fakeGit({}, calls) })
    expect(report).toMatchObject({
      status: 'up-to-date',
      base: 'origin/main',
      branch: 'feat/x',
      fetch: 'fresh',
      tree: 'clean',
      ahead: 0,
      behind: 0,
    })
    expect(calls[1]).toEqual([
      'fetch',
      'origin',
      '+main:refs/remotes/origin/main',
      '--quiet',
      'timeout=8000',
    ])
    expect(calls).toContainEqual([
      'rev-list',
      '--left-right',
      '--count',
      'refs/remotes/origin/main...HEAD',
    ])
  })

  it('honors remote, branch, timeout, and skipFetch', () => {
    const calls: string[][] = []
    const options = { remote: 'upstream', branch: 'trunk', git: fakeGit({}, calls) }
    checkFreshBase({ ...options, fetchTimeoutMs: 50 })
    expect(calls[1]).toEqual([
      'fetch',
      'upstream',
      '+trunk:refs/remotes/upstream/trunk',
      '--quiet',
      'timeout=50',
    ])
    calls.length = 0
    expect(checkFreshBase({ ...options, skipFetch: true })).toMatchObject({
      fetch: 'skipped',
      base: 'upstream/trunk',
    })
    expect(calls.some((call) => call[0] === 'fetch')).toBe(false)
  })

  it('reads behind then ahead from the left-right count', () => {
    const counts = { status: 0, stdout: '3\t1\n' }
    expect(checkFreshBase({ git: fakeGit({ counts }) })).toMatchObject({
      status: 'diverged',
      behind: 3,
      ahead: 1,
    })
  })

  it('reports dirty trees and detached HEAD', () => {
    const status = { status: 0, stdout: '?? new.txt\n' }
    expect(checkFreshBase({ git: fakeGit({ status, branch: '\n' }) })).toMatchObject({
      status: 'dirty',
      branch: 'detached HEAD',
    })
  })

  it('reports a failed fetch and keeps comparing against the cached ref', () => {
    expect(checkFreshBase({ git: fakeGit({ fetch: 128 }) })).toMatchObject({
      status: 'fetch-failed',
      fetch: 'failed',
      relation: 'matches',
    })
  })

  it('reports unknown when the ref, counts, or status are unavailable', () => {
    expect(checkFreshBase({ git: fakeGit({ ref: 1 }) })).toMatchObject({
      status: 'unknown',
      ahead: null,
      behind: null,
    })
    for (const stdout of ['', 'x y']) {
      expect(checkFreshBase({ git: fakeGit({ counts: { status: 0, stdout } }) })?.status).toBe(
        'unknown',
      )
    }
    expect(checkFreshBase({ git: fakeGit({ counts: { status: 1, stdout: '0 0' } }) })?.ahead).toBe(
      null,
    )
    expect(checkFreshBase({ git: fakeGit({ status: { status: 128, stdout: '' } }) })).toMatchObject(
      { tree: 'unknown', status: 'unknown' },
    )
  })

  it('returns null outside a repository and rejects option-like names', () => {
    expect(checkFreshBase({ git: fakeGit({ repo: 128 }) })).toBeNull()
    expect(() => checkFreshBase({ remote: '-c', git: fakeGit({}) })).toThrow('remote must')
    expect(() => checkFreshBase({ branch: '', git: fakeGit({}) })).toThrow('branch must')
  })

  it('runs real git by default', () => {
    const root = mkdtempSync(join(tmpdir(), 'fresh-base-'))
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, { cwd, stdio: 'ignore' })
    try {
      const remote = join(root, 'remote.git')
      const work = join(root, 'work')
      git(root, 'init', '--bare', '--quiet', remote)
      git(root, 'init', '--quiet', work)
      git(work, 'config', 'user.name', 'Test User')
      git(work, 'config', 'user.email', 'test@example.com')
      git(work, 'config', 'commit.gpgsign', 'false')
      writeFileSync(join(work, 'a.txt'), 'a\n')
      git(work, 'add', 'a.txt')
      git(work, 'commit', '--quiet', '-m', 'initial')
      git(work, 'branch', '-M', 'main')
      git(work, 'remote', 'add', 'origin', remote)
      git(work, 'push', '--quiet', 'origin', 'main')

      expect(checkFreshBase({ cwd: work })).toMatchObject({ status: 'up-to-date', fetch: 'fresh' })
      writeFileSync(join(work, 'b.txt'), 'b\n')
      expect(checkFreshBase({ cwd: work, skipFetch: true })?.status).toBe('dirty')
      expect(checkFreshBase({ cwd: work, remote: 'missing' })?.status).toBe('fetch-failed')
      expect(checkFreshBase({ cwd: root })).toBeNull()
      expect(checkFreshBase({ cwd: join(root, 'absent') })).toBeNull()
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
