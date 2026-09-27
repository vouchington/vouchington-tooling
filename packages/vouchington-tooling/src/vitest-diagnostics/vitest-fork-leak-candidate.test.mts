import { describe, expect, it } from 'vitest'
import { createForkLeakDetector } from './vitest-fork-leak-detection.mts'

const TYPE = 'TCPSocketWrap'

function recordAll(detector: ReturnType<typeof createForkLeakDetector>, counts: readonly number[]) {
  return counts.flatMap((count) => detector.record(new Map([[TYPE, count]])))
}

describe('fork leak candidate confirmation', () => {
  it('expires stale primary evidence before a later higher count creates a new candidate', () => {
    const detector = createForkLeakDetector()
    recordAll(detector, [...Array(5).fill(1), 20, 21, 22, 21, 22])
    recordAll(detector, Array(6).fill([20, 21]).flat())

    expect(recordAll(detector, [23])).toEqual([])
    expect(recordAll(detector, [24])).toMatchObject([
      { baseline: 1, current: 24, growthCheckpoints: 4 },
    ])
  })

  it('allows only the last checkpoint in the confirmation lifetime', () => {
    const allowed = createForkLeakDetector({
      warmupCheckpoints: 1,
      leakThreshold: 0,
      sustainedCheckpoints: 3,
    })
    const expired = createForkLeakDetector({
      warmupCheckpoints: 1,
      leakThreshold: 0,
      sustainedCheckpoints: 3,
    })

    expect(recordAll(allowed, [1, 2, 3, 4, 3, 4, 5])).toMatchObject([{ current: 5 }])
    expect(recordAll(expired, [1, 2, 3, 4, 3, 4, 3, 5])).toEqual([])
  })

  it('allows rolling recovery below an expired primary spike', () => {
    const detector = createForkLeakDetector()
    recordAll(detector, [...Array(5).fill(1), 100, 110, 120, 110, 120])
    recordAll(detector, Array(6).fill([110, 120]).flat())

    expect(recordAll(detector, [20, 21, 22, 23, 24])).toEqual([])
    expect(recordAll(detector, [25])).toMatchObject([
      {
        baseline: 1,
        current: 25,
        growthCheckpoints: 4,
        suspectedGrowth: { previous: 20, current: 21, delta: 1 },
      },
    ])
  })

  it('replaces a pending primary candidate with a lower rolling recovery candidate', () => {
    const detector = createForkLeakDetector()

    expect(recordAll(detector, [...Array(5).fill(1), 20, 40, 100, 50, 30, 31, 32, 33, 34])).toEqual(
      [],
    )
    expect(recordAll(detector, [35])).toMatchObject([
      {
        baseline: 1,
        current: 35,
        streak: 5,
        growthCheckpoints: 4,
        suspectedGrowth: { previous: 30, current: 31, delta: 1 },
      },
    ])
  })

  it('does not resurrect a primary candidate displaced by rolling recovery', () => {
    const detector = createForkLeakDetector()

    expect(
      recordAll(detector, [
        ...Array(5).fill(1),
        20,
        40,
        100,
        50,
        30,
        31,
        32,
        33,
        34,
        33,
        34,
        33,
        34,
        33,
        34,
        101,
      ]),
    ).toEqual([])
    expect(recordAll(detector, [102])).toMatchObject([
      { baseline: 1, current: 102, growthCheckpoints: 4 },
    ])
  })
})
