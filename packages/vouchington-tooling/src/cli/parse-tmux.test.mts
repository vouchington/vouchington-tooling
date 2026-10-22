import { describe, expect, it } from 'vitest'

import { parseCli } from './parse.mts'

describe('parseCli tmux', () => {
  it('forwards the tmux subcommand without interpreting its arguments', () => {
    expect(parseCli(['node', 'vouchington', 'tmux', 'up', '--config', 'x.json'])).toEqual({
      kind: 'tmux',
      args: ['up', '--config', 'x.json'],
    })
  })
})
