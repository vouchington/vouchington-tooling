import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it } from 'vitest'

import { formatReport, reclaimWorktrees } from './reclaim.mts'
import { createFixture, type Fixture } from './reclaim.test-helpers.mts'

let fx: Fixture
beforeEach(() => {
  fx = createFixture()
})
afterEach(() => {
  fx.cleanup()
})

function runtime() {
  return { cwd: fx.caller, env: fx.env }
}

it('shares discovery across branches, and only rechecks deletion candidates', () => {
  const log = join(fx.root, 'requests')
  fx.addWorktree('done')
  fx.addWorktree('open')
  fx.addWorktree('unknown')
  fx.setPrs('done', [{ state: 'MERGED' }])
  fx.setPrs('open', [{ state: 'OPEN' }])
  const env = { ...fx.env, FAKE_GH_LOG: log }
  const report = reclaimWorktrees(false, { ...runtime(), env })
  expect(report.worktrees.filter((e) => e.status === 'would reclaim').map((e) => e.branch)).toEqual(
    ['done'],
  )
  const calls = () =>
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])
  expect(calls()).toHaveLength(2)
  expect(calls().every((args) => !args.includes('--head'))).toBe(true)
  reclaimWorktrees(true, { ...runtime(), env })
  const checks = calls().filter((args) => args.includes('--head'))
  expect(checks).toHaveLength(2)
  expect(checks.every((args) => args[args.indexOf('--head') + 1] === 'done')).toBe(true)
})

it('resumes a bounded scan after its reported path, including after that path was deleted', () => {
  const a = fx.addWorktree('aaa')
  const b = fx.addWorktree('bbb')
  fx.setPrs('aaa', [{ state: 'MERGED' }])
  fx.setPrs('bbb', [{ state: 'MERGED' }])
  const first = reclaimWorktrees(true, runtime(), { maxWorktrees: 1 })
  expect(first).toMatchObject({ hasMore: true, nextAfter: a })
  expect(existsSync(a)).toBe(false)
  const rest = reclaimWorktrees(true, runtime(), { after: first.nextAfter! })
  expect(rest.hasMore).toBe(false)
  expect(rest.worktrees.map((e) => e.path)).toEqual([b])
  expect(existsSync(b)).toBe(false)
})

it('keeps everything when discovery uses the time budget and provides a retry cursor', () => {
  const path = fx.addWorktree('done')
  fx.setPrs('done', [{ state: 'MERGED' }])
  const log = join(fx.root, 'requests')
  const env = { ...fx.env, FAKE_GH_LOG: log }
  const now = () => (existsSync(log) ? 30_000 : 0)
  const report = reclaimWorktrees(true, { ...runtime(), env }, { now })
  expect(report).toMatchObject({ hasMore: true, nextAfter: '', worktrees: [] })
  expect(existsSync(path)).toBe(true)
  expect(formatReport(report)).toContain("--after ''")
})

it('accepts bounded history while retaining exact HEAD proof', () => {
  fx.addWorktree('done')
  fx.setPrs('done', [{ state: 'MERGED' }])
  const report = reclaimWorktrees(false, {
    ...runtime(),
    env: { ...fx.env, FAKE_GH_PAD_ALL: '1000' },
  })
  expect(report.worktrees[0]?.status).toBe('would reclaim')
})

it('keeps a discovery candidate when fresh branch history is truncated', () => {
  const path = fx.addWorktree('done')
  fx.setPrs('done', [{ state: 'MERGED' }])
  const report = reclaimWorktrees(true, {
    ...runtime(),
    env: { ...fx.env, FAKE_GH_PAD_ALL: '1000' },
  })
  expect(report.worktrees[0]).toMatchObject({ status: 'kept', reason: 'changed since check' })
  expect(existsSync(path)).toBe(true)
})

it.each([{ maxWorktrees: 0 }, { timeoutMs: -1 }, { maxWorktrees: Infinity }, { prLimit: 10001 }])(
  'rejects invalid scan limits %j',
  (options) => {
    expect(() => reclaimWorktrees(true, runtime(), options)).toThrow('positive integers')
  },
)

it('keeps a candidate when the final safety reads exhaust the budget and retries that path', () => {
  const path = fx.addWorktree('done')
  fx.setPrs('done', [{ state: 'MERGED' }])
  const log = join(fx.root, 'git-requests')
  const env = { ...fx.env, FAKE_GIT_LOG: log }
  const now = () => {
    const requests = existsSync(log) ? readFileSync(log, 'utf8').split('\n') : []
    return requests.filter((args) => args.includes('worktree list --porcelain')).length >= 2
      ? 30_000
      : 0
  }
  const report = reclaimWorktrees(true, { ...runtime(), env }, { now })
  expect(report).toMatchObject({ hasMore: true, nextAfter: fx.caller })
  expect(report.worktrees).toEqual([
    { path, branch: 'done', status: 'kept', reason: 'scan budget exhausted' },
  ])
  expect(existsSync(path)).toBe(true)
  const rest = reclaimWorktrees(true, runtime(), { after: report.nextAfter! })
  expect(rest.worktrees).toEqual([{ path, branch: 'done', status: 'reclaimed' }])
  expect(rest.hasMore).toBe(false)
})
