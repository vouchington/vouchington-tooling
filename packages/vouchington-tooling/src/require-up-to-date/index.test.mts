import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { requireUpToDate } from './index.mts'

describe('require-up-to-date', () => {
  it('fetches the requested branch and requires it to be an ancestor of HEAD', () => {
    const calls: string[][] = []
    requireUpToDate({
      remote: 'origin',
      branch: 'main',
      execute: (args) => {
        calls.push([...args])
        return 0
      },
    })
    expect(calls).toEqual([
      ['fetch', '--quiet', 'origin', 'main'],
      ['merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD'],
    ])
  })

  it('fails when the current HEAD does not include the fetched branch', () => {
    expect(() =>
      requireUpToDate({
        remote: 'origin',
        branch: 'main',
        execute: (args) => (args[0] === 'merge-base' ? 1 : 0),
      }),
    ).toThrow('Current HEAD is not up to date with origin/main')
  })

  it('rejects invalid names and unexpected git failures', () => {
    for (const [remote, branch] of [
      ['-c', 'main'],
      ['origin', '-c'],
      ['origin', ''],
    ] as const) {
      expect(() => requireUpToDate({ remote, branch })).toThrow()
    }
    expect(() => requireUpToDate({ remote: 'origin', branch: 'main', execute: () => 128 })).toThrow(
      'git fetch failed with exit code 128',
    )
  })

  it('reports non-ancestry merge-base failures', () => {
    expect(() =>
      requireUpToDate({
        remote: 'origin',
        branch: 'main',
        execute: (args) => (args[0] === 'merge-base' ? 128 : 0),
      }),
    ).toThrow('git merge-base failed with exit code 128')
  })

  it('uses git by default and rethrows failures without an exit status', () => {
    const root = mkdtempSync(join(process.cwd(), '.require-up-to-date-'))
    try {
      const remote = join(root, 'remote.git')
      execFileSync('git', ['init', '--quiet'], { cwd: root })
      execFileSync('git', ['config', 'user.email', 'test@example.test'], { cwd: root })
      execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root })
      writeFileSync(join(root, 'tracked.txt'), 'tracked\n')
      execFileSync('git', ['add', 'tracked.txt'], { cwd: root })
      execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root })
      execFileSync('git', ['branch', '-M', 'main'], { cwd: root })
      execFileSync('git', ['init', '--bare', '--quiet', remote])
      execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root })
      execFileSync('git', ['push', '--quiet', '-u', 'origin', 'main'], { cwd: root })

      expect(() => requireUpToDate({ remote: 'origin', branch: 'main', cwd: root })).not.toThrow()
      expect(() =>
        requireUpToDate({
          remote: 'origin',
          branch: 'main',
          cwd: join(root, 'missing-directory'),
        }),
      ).toThrow(/ENOENT/u)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
