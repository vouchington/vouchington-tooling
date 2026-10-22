import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFixture, type Fixture } from '../../git-worktrees/reclaim.test-helpers.mts'
import { runWorktreeCommand } from './worktree.mts'

let fx: Fixture
let stdout: string
let stderr: string

beforeEach(() => {
  fx = createFixture()
  stdout = ''
  stderr = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => ((stdout += String(chunk)), true))
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => ((stderr += String(chunk)), true))
})
afterEach(() => {
  vi.restoreAllMocks()
  fx.cleanup()
})

describe('runWorktreeCommand', () => {
  it('prints a text dry run', () => {
    const path = fx.addWorktree('done', { push: true })
    fx.setPrs('done', [{ state: 'MERGED' }])
    expect(runWorktreeCommand(['reclaim'], fx.env, fx.caller)).toBe(0)
    expect(stdout).toBe(`${path}: would reclaim\n`)
  })

  it('applies with --yes and prints JSON with --json', () => {
    fx.addWorktree('done', { push: true })
    fx.setPrs('done', [{ state: 'CLOSED' }])
    expect(runWorktreeCommand(['reclaim', '--yes', '--json'], fx.env, fx.caller)).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({
      dryRun: false,
      worktrees: [{ branch: 'done', status: 'reclaimed' }],
    })
  }, 30_000)

  it.each([[[]], [['prune']], [['reclaim', '--force']]])(
    'rejects %j with usage and exit 2',
    (args) => {
      expect(runWorktreeCommand(args, fx.env, fx.caller)).toBe(2)
      expect(stderr).toContain('worktree reclaim [--yes] [--json]')
    },
  )

  it('exits 1 outside a repository', () => {
    expect(runWorktreeCommand(['reclaim'], fx.env, fx.root)).toBe(1)
    expect(stderr).toContain('not inside a git worktree')
  })
})
