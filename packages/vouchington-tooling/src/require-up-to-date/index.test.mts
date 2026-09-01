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
})
