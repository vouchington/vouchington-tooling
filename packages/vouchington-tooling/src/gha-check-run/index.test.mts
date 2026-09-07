import { describe, expect, it } from 'vitest'

import { CheckRunError, completeCheckRun, createCheckRun, runCheckRunCli } from './index.mts'

describe('gha-check-run exports', () => {
  it('re-exports check-run helpers', () => {
    expect(typeof createCheckRun).toBe('function')
    expect(typeof completeCheckRun).toBe('function')
    expect(typeof runCheckRunCli).toBe('function')
    expect(new CheckRunError('x').name).toBe('CheckRunError')
  })
})
