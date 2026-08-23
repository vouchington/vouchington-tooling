import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../gha-post-review/cli.mts', () => ({
  runPostReviewCli: vi.fn(async () => 0),
}))

import { runPostReviewCli } from '../../gha-post-review/cli.mts'
import { runPostReviewCommand } from './post-review.mts'

describe('runPostReviewCommand', () => {
  afterEach(() => {
    vi.mocked(runPostReviewCli).mockReset()
  })

  it('delegates to the library CLI', async () => {
    vi.mocked(runPostReviewCli).mockResolvedValue(0)
    await expect(runPostReviewCommand()).resolves.toBe(0)
  })
})
