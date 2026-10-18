import { describe, expect, it } from 'vitest'

import { parseCli } from './parse.mts'

describe('parseCli worktree', () => {
  it('forwards the worktree subcommand without interpreting its arguments', () => {
    expect(parseCli(['node', 'vouchington', 'worktree', 'reclaim', '--yes'])).toEqual({
      kind: 'worktree',
      args: ['reclaim', '--yes'],
    })
  })
})
