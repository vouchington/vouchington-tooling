import { describe, expect, it } from 'vitest'

import { parseCli } from './parse.mts'

describe('parseCli Vitest report commands', () => {
  it('forwards report-attempt and report-preparation arguments', () => {
    expect(parseCli(['node', 'vouchington', 'vitest-report-attempt', 'read', 'markers'])).toEqual({
      kind: 'vitest-report-attempt',
      args: ['read', 'markers'],
    })
    expect(parseCli(['node', 'vouchington', 'prepare-vitest-reports'])).toEqual({
      kind: 'prepare-vitest-reports',
      args: [],
    })
  })
})
