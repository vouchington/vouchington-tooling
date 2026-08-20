import { describe, expect, it } from 'vitest'

import { createArtifactClassifier } from './index.mts'
import {
  isSweepCandidate,
  nextPagingState,
  planRunDeletions,
  planSweepDeletions,
  shouldStopPaging,
  summarize,
  type ArtifactLike,
} from './plan.mts'

const classify = createArtifactClassifier({
  keepPatterns: ['plan-*'],
  deletePatterns: ['coverage-*'],
}).classify

function artifact(overrides: Partial<ArtifactLike> = {}): ArtifactLike {
  return {
    id: 1,
    name: 'coverage-unit',
    size_in_bytes: 100,
    expired: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('summarize', () => {
  it('sums count and bytes', () => {
    expect(summarize([artifact({ size_in_bytes: 10 }), artifact({ size_in_bytes: 20 })])).toEqual({
      deletedCount: 2,
      bytesFreed: 30,
    })
    expect(summarize([])).toEqual({ deletedCount: 0, bytesFreed: 0 })
  })
})

describe('planRunDeletions', () => {
  it('keeps a non-expired delete-classified artifact', () => {
    expect(planRunDeletions([artifact({ name: 'coverage-unit' })], classify)).toHaveLength(1)
  })

  it('drops expired and keep-classified artifacts', () => {
    expect(
      planRunDeletions([artifact({ name: 'coverage-unit', expired: true })], classify),
    ).toEqual([])
    expect(planRunDeletions([artifact({ name: 'plan-main' })], classify)).toEqual([])
  })
})

describe('isSweepCandidate', () => {
  const cutoff = '2026-01-02T00:00:00Z'

  it('accepts an old, non-expired, delete-classified artifact', () => {
    expect(
      isSweepCandidate(artifact({ created_at: '2026-01-01T00:00:00Z' }), cutoff, classify),
    ).toBe(true)
  })

  it('rejects newer, expired, or keep-classified artifacts', () => {
    expect(
      isSweepCandidate(artifact({ created_at: '2026-01-03T00:00:00Z' }), cutoff, classify),
    ).toBe(false)
    expect(
      isSweepCandidate(
        artifact({ created_at: '2026-01-01T00:00:00Z', expired: true }),
        cutoff,
        classify,
      ),
    ).toBe(false)
    expect(
      isSweepCandidate(
        artifact({ name: 'plan-main', created_at: '2026-01-01T00:00:00Z' }),
        cutoff,
        classify,
      ),
    ).toBe(false)
  })
})

describe('shouldStopPaging / nextPagingState', () => {
  it('stops at the page cap, empty pages, and expired streaks', () => {
    expect(shouldStopPaging([artifact()], { page: 150, consecutiveExpiredPages: 0 })).toBe(true)
    expect(shouldStopPaging([], { page: 1, consecutiveExpiredPages: 0 })).toBe(true)
    expect(
      shouldStopPaging([artifact({ expired: true })], { page: 2, consecutiveExpiredPages: 5 }),
    ).toBe(true)
    expect(shouldStopPaging([artifact()], { page: 2, consecutiveExpiredPages: 0 })).toBe(false)
  })

  it('increments the expired streak only when the whole page is expired', () => {
    const mixed = [artifact({ expired: true }), artifact({ expired: false })]
    expect(nextPagingState(mixed, { page: 1, consecutiveExpiredPages: 3 })).toEqual({
      page: 2,
      consecutiveExpiredPages: 0,
    })
    const allExpired = [artifact({ expired: true }), artifact({ expired: true })]
    expect(nextPagingState(allExpired, { page: 1, consecutiveExpiredPages: 3 })).toEqual({
      page: 2,
      consecutiveExpiredPages: 4,
    })
  })
})

describe('planSweepDeletions', () => {
  it('keeps candidates whose run succeeded or was cancelled', async () => {
    const candidates = [
      artifact({ id: 1, workflow_run: { id: 10 } }),
      artifact({ id: 2, workflow_run: { id: 20 } }),
      artifact({ id: 3, workflow_run: { id: 30 } }),
    ]
    const conclusions: Record<number, string | null> = {
      10: 'success',
      20: 'cancelled',
      30: 'failure',
    }
    const kept = await planSweepDeletions(candidates, async (runId) => conclusions[runId] ?? null)
    expect(kept.map((item) => item.id)).toEqual([1, 2])
  })

  it('skips an artifact with no producing run id', async () => {
    const kept = await planSweepDeletions([artifact()], async () => 'success')
    expect(kept).toEqual([])
  })
})
