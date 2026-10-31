import { describe, expect, it } from 'vitest'

import { parseCli } from './parse.mts'

describe('parseCli final-review', () => {
  it('forwards arguments without interpreting them', () => {
    expect(parseCli(['node', 'vouchington', 'final-review', 'bench', '--cases', 'c.json'])).toEqual(
      { kind: 'final-review', args: ['bench', '--cases', 'c.json'] },
    )
    expect(parseCli(['node', 'vouchington', 'final-review'])).toEqual({
      kind: 'final-review',
      args: [],
    })
  })
})
