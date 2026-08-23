import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../gha-review-payload/cli.mts', () => ({
  runStageReviewPayloadCli: vi.fn(() => 0),
}))

import { runStageReviewPayloadCli } from '../../gha-review-payload/cli.mts'
import { runStageReviewPayloadCommand } from './stage-review-payload.mts'

describe('runStageReviewPayloadCommand', () => {
  afterEach(() => {
    vi.mocked(runStageReviewPayloadCli).mockReset()
  })

  it('delegates arguments to the library CLI', () => {
    vi.mocked(runStageReviewPayloadCli).mockReturnValue(0)
    expect(runStageReviewPayloadCommand(['optional', 'a', 'b'])).toBe(0)
    expect(runStageReviewPayloadCli).toHaveBeenCalledWith(['optional', 'a', 'b'])
  })
})
