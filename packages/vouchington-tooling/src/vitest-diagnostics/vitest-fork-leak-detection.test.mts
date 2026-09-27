import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createForkLeakDetector,
  LEAK_THRESHOLD,
  SUSTAINED_CHECKPOINTS,
  waitForResourceCloseCallbacks,
  WARMUP_CHECKPOINTS,
} from './vitest-fork-leak-detection.mts'

const TYPE = 'TCPSocketWrap'
function recordAll(detector: ReturnType<typeof createForkLeakDetector>, counts: readonly number[]) {
  const verdicts = []
  for (const count of counts) {
    verdicts.push(...detector.record(new Map([[TYPE, count]])))
  }
  return verdicts
}

function growthStep(previous: number, current: number, testFile: string | null = null) {
  return { testFile, previous, current, delta: current - previous }
}

function expectedVerdict(overrides: {
  type?: string
  baseline: number
  current: number
  streak: number
  growthCheckpoints?: number
  requiredGrowthCheckpoints?: number
  detectedInFile?: string | null
  suspectedGrowth?: {
    testFile: string | null
    previous: number
    current: number
    delta: number
  } | null
}) {
  return {
    type: TYPE,
    growthCheckpoints: 0,
    requiredGrowthCheckpoints: Math.floor(overrides.streak / 2) + 1,
    detectedInFile: null,
    suspectedGrowth: null,
    ...overrides,
  }
}

describe('createForkLeakDetector', () => {
  it('never flags a steady-state resource count', () => {
    const detector = createForkLeakDetector()
    const counts = Array.from({ length: 50 }, () => 5)

    expect(recordAll(detector, counts)).toEqual([])
  })

  it('absorbs ramp-up during warmup into the baseline', () => {
    const detector = createForkLeakDetector()
    const rampUp = Array.from({ length: WARMUP_CHECKPOINTS }, (_, i) => i + 1)
    const plateau = Array.from({ length: 50 }, () => WARMUP_CHECKPOINTS)

    expect(recordAll(detector, [...rampUp, ...plateau])).toEqual([])
  })

  it('does not flag a one-time jump that stays within the leak threshold', () => {
    const detector = createForkLeakDetector()
    const baseline = 2
    const warmup = Array.from({ length: WARMUP_CHECKPOINTS }, () => baseline)
    const plateau = Array.from({ length: 50 }, () => baseline + LEAK_THRESHOLD)

    expect(recordAll(detector, [...warmup, ...plateau])).toEqual([])
  })

  it('does not flag a transient spike that recedes before the sustained window', () => {
    const detector = createForkLeakDetector()
    const baseline = 2
    const warmup = Array.from({ length: WARMUP_CHECKPOINTS }, () => baseline)
    const spikeHigh = baseline + LEAK_THRESHOLD + 1
    // Repeated spikes recede before the sustained-checkpoint count can accumulate.
    const flicker = Array.from({ length: SUSTAINED_CHECKPOINTS * 3 }, (_, i) =>
      i % 2 === 0 ? spikeHigh : baseline,
    )

    expect(recordAll(detector, [...warmup, ...flicker])).toEqual([])
  })

  it('flags sustained growth past the sustained-checkpoint window', () => {
    const detector = createForkLeakDetector()
    const baseline = 2
    const warmup = Array.from({ length: WARMUP_CHECKPOINTS }, () => baseline)
    const elevatedStart = baseline + LEAK_THRESHOLD + 1
    // Climbs by 1 every checkpoint — the signature of an actual per-test leak, not a one-time
    // step to a new plateau (see the "absorbs" test below for that case).
    const growth = Array.from({ length: SUSTAINED_CHECKPOINTS + 3 }, (_, i) => elevatedStart + i)

    const verdicts = recordAll(detector, [...warmup, ...growth])

    expect(verdicts).toEqual([
      expectedVerdict({
        baseline,
        current: elevatedStart + SUSTAINED_CHECKPOINTS,
        streak: SUSTAINED_CHECKPOINTS,
        growthCheckpoints: SUSTAINED_CHECKPOINTS,
        suspectedGrowth: growthStep(baseline, elevatedStart),
      }),
    ])
  })

  it('attributes a bystander trip to the file with the largest growth step', () => {
    const detector = createForkLeakDetector({
      warmupCheckpoints: 1,
      leakThreshold: 0,
      sustainedCheckpoints: 3,
    })
    detector.record(new Map([[TYPE, 5]]), 'warmup.test.mts')
    detector.record(new Map([[TYPE, 10]]), 'source.test.mts')
    detector.record(new Map([[TYPE, 11]]), 'bystander.test.mts')
    detector.record(new Map([[TYPE, 12]]), 'bystander.test.mts')

    const verdicts = detector.record(new Map([[TYPE, 13]]), 'bystander.test.mts')

    expect(verdicts).toEqual([
      expectedVerdict({
        baseline: 5,
        current: 13,
        streak: 3,
        growthCheckpoints: 3,
        detectedInFile: 'bystander.test.mts',
        suspectedGrowth: growthStep(5, 10, 'source.test.mts'),
      }),
    ])
  })

  it('does not flag a one-time step to a new elevated plateau that never grows further', () => {
    const detector = createForkLeakDetector()
    const baseline = 2
    const warmup = Array.from({ length: WARMUP_CHECKPOINTS }, () => baseline)
    // Steps once to a new elevated value and holds flat there well past the sustained window —
    // e.g. a connection pool a later file in the fork's sequence is first to lazily open. It
    // never climbs further, so it must be absorbed as the new baseline, not flagged as a leak.
    const plateau = baseline + LEAK_THRESHOLD + 1
    const held = Array.from({ length: SUSTAINED_CHECKPOINTS + 20 }, () => plateau)

    expect(recordAll(detector, [...warmup, ...held])).toEqual([])
  })

  it('still flags further growth layered on top of an earlier absorbed plateau', () => {
    const detector = createForkLeakDetector()
    const baseline = 2
    const warmup = Array.from({ length: WARMUP_CHECKPOINTS }, () => baseline)
    const plateau = baseline + LEAK_THRESHOLD + 1
    const held = Array.from({ length: SUSTAINED_CHECKPOINTS + 1 }, () => plateau)
    // Climbs again from the absorbed plateau — a real leak layered on top of an earlier
    // legitimate step must still be caught.
    const elevatedStart = plateau + LEAK_THRESHOLD + 1
    const furtherGrowth = Array.from(
      { length: SUSTAINED_CHECKPOINTS + 3 },
      (_, i) => elevatedStart + i,
    )

    const verdicts = recordAll(detector, [...warmup, ...held, ...furtherGrowth])

    expect(verdicts).toEqual([
      expectedVerdict({
        baseline: plateau,
        current: elevatedStart + SUSTAINED_CHECKPOINTS,
        streak: SUSTAINED_CHECKPOINTS,
        growthCheckpoints: SUSTAINED_CHECKPOINTS,
        suspectedGrowth: growthStep(plateau, elevatedStart),
      }),
    ])
  })

  it('reports a leaking type at most once per detector instance', () => {
    const detector = createForkLeakDetector()
    const baseline = 2
    const warmup = Array.from({ length: WARMUP_CHECKPOINTS }, () => baseline)
    const elevatedStart = baseline + LEAK_THRESHOLD + 1
    // Keeps climbing well past the first sustained-growth verdict.
    const growth = Array.from({ length: SUSTAINED_CHECKPOINTS + 20 }, (_, i) => elevatedStart + i)

    expect(recordAll(detector, [...warmup, ...growth])).toHaveLength(1)
  })

  it('reports every type that reaches the sustained window in the same checkpoint', () => {
    const detector = createForkLeakDetector()
    const baseline = 2
    const typeA = 'TCPSocketWrap'
    const typeB = 'TLSWrap'
    const warmup = Array.from(
      { length: WARMUP_CHECKPOINTS },
      () =>
        new Map([
          [typeA, baseline],
          [typeB, baseline],
        ]),
    )
    const elevatedStart = baseline + LEAK_THRESHOLD + 1
    // Both types climb in lockstep, so both reach SUSTAINED_CHECKPOINTS on the same call —
    // the case where a `verdict ??=` single-slot return would silently drop the second type.
    const growth = Array.from({ length: SUSTAINED_CHECKPOINTS + 3 }, (_, i) => {
      const current = elevatedStart + i
      return new Map([
        [typeA, current],
        [typeB, current],
      ])
    })

    const verdicts = [...warmup, ...growth].flatMap((counts) => detector.record(counts))

    expect(verdicts).toEqual([
      expectedVerdict({
        type: typeA,
        baseline,
        current: elevatedStart + SUSTAINED_CHECKPOINTS,
        streak: SUSTAINED_CHECKPOINTS,
        growthCheckpoints: SUSTAINED_CHECKPOINTS,
        suspectedGrowth: growthStep(baseline, elevatedStart),
      }),
      expectedVerdict({
        type: typeB,
        baseline,
        current: elevatedStart + SUSTAINED_CHECKPOINTS,
        streak: SUSTAINED_CHECKPOINTS,
        growthCheckpoints: SUSTAINED_CHECKPOINTS,
        suspectedGrowth: growthStep(baseline, elevatedStart),
      }),
    ])
  })

  it('never flags growth of a type outside the tracked set', () => {
    const detector = createForkLeakDetector()
    const warmup = Array.from({ length: WARMUP_CHECKPOINTS }, () => new Map([['Timeout', 1]]))
    // Grows unboundedly well past every safeguard threshold — 'Timeout' is excluded from
    // PERSISTENT_HANDLE_TYPES, so it must never be considered regardless of magnitude.
    const growth = Array.from({ length: 50 }, (_, i) => new Map([['Timeout', 1 + (i + 1) * 10]]))

    const verdicts = [...warmup, ...growth].flatMap((counts) => detector.record(counts))

    expect(verdicts).toEqual([])
  })
})

describe('waitForResourceCloseCallbacks', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves even when the current test uses fake timers', async () => {
    vi.useFakeTimers()

    await expect(waitForResourceCloseCallbacks()).resolves.toBeUndefined()
  })
})
