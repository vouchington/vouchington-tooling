import { realpathSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, realpathSync: vi.fn(actual.realpathSync) }
})

import { reclaimWorktrees } from './reclaim.mts'
import { createFixture, type Fixture } from './reclaim.test-helpers.mts'

let fx: Fixture
beforeEach(() => {
  fx = createFixture()
})
afterEach(() => {
  vi.mocked(realpathSync).mockRestore()
  fx.cleanup()
})

it('reports a candidate that fails mid-run as kept and carries on', () => {
  const broken = fx.addWorktree('vanishing', { push: true })
  const fine = fx.addWorktree('fine', { push: true })
  fx.setPrs('vanishing', [{ state: 'MERGED' }])
  fx.setPrs('fine', [{ state: 'MERGED' }])
  const real = vi.mocked(realpathSync).getMockImplementation()!
  vi.mocked(realpathSync).mockImplementation(((path: string) => {
    if (path === broken) throw new Error('ENOENT: vanished')
    return (real as (p: string) => string)(path)
  }) as typeof realpathSync)
  const report = reclaimWorktrees(true, { cwd: join(fx.caller), env: fx.env })
  const byBranch = Object.fromEntries(report.worktrees.map((e) => [e.branch, e]))
  expect(byBranch.vanishing).toMatchObject({
    path: broken,
    status: 'kept',
    reason: 'error: ENOENT: vanished',
  })
  expect(byBranch.fine).toMatchObject({ path: fine, status: 'reclaimed' })
}, 30_000)
