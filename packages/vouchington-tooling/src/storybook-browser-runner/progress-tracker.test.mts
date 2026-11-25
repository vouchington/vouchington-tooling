import { describe, expect, it } from 'vitest'

import { formatStorybookProgressMarker } from '../vitest-diagnostics/vitest-storybook-progress-reporter.mts'
import { ProgressTracker } from './progress-tracker.mts'

const PREFIX = '[p]'
const marker = (
  seq: number,
  event: Parameters<typeof formatStorybookProgressMarker>[1],
  module: string,
  test?: string,
) => formatStorybookProgressMarker(seq, event, module, PREFIX, test)

describe('ProgressTracker', () => {
  it('names the module and test that started but did not end', () => {
    const tracker = new ProgressTracker(PREFIX)
    tracker.observe(
      marker(1, 'module-start', 'a.stories.tsx') + marker(2, 'module-end', 'a.stories.tsx'),
      100,
    )
    tracker.observe(
      marker(3, 'module-collected', 'b.stories.tsx') +
        marker(4, 'module-start', 'b.stories.tsx') +
        marker(5, 'test-start', 'b.stories.tsx', 'Button > Primary'),
      200,
    )
    const context = tracker.context(1_000)
    expect(context.inFlight).toEqual([
      {
        module: 'b.stories.tsx',
        runningForMs: 800,
        test: { name: 'Button > Primary', runningForMs: 800 },
      },
    ])
    expect(context.lastEnded).toEqual({ endedAgoMs: 900, module: 'a.stories.tsx' })
    expect(context.collectedNotStarted).toEqual([])
    expect(context.recentMarkers.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5])
    expect(context.recentMarkers[4]).toEqual({
      agoMs: 800,
      event: 'test-start',
      module: 'b.stories.tsx',
      seq: 5,
      test: 'Button > Primary',
    })
  })

  it('clears the test on test-end and the module on module-end', () => {
    const tracker = new ProgressTracker(PREFIX)
    tracker.observe(marker(1, 'module-start', 'm') + marker(2, 'test-start', 'm', 't1'), 0)
    tracker.observe(marker(3, 'test-end', 'm', 't2'), 0)
    expect(tracker.context(0).inFlight[0]!.test?.name).toBe('t1')
    tracker.observe(marker(4, 'test-end', 'm', 't1'), 0)
    expect(tracker.context(0).inFlight[0]!.test).toBeNull()
    tracker.observe(marker(5, 'module-end', 'm'), 0)
    expect(tracker.context(0).inFlight).toEqual([])
  })

  it('treats a test marker without a test name as an unnamed test', () => {
    const tracker = new ProgressTracker(PREFIX)
    tracker.observe('[p] seq=1 event=test-start module="m"\n', 0)
    expect(tracker.context(0).inFlight[0]!.test?.name).toBe('')
    tracker.observe('[p] seq=2 event=test-end module="m"\n', 0)
    expect(tracker.context(0).inFlight[0]!.test).toBeNull()
  })

  it('reports collected modules separately and starts a module from its first test', () => {
    const tracker = new ProgressTracker(PREFIX)
    tracker.observe(marker(1, 'module-collected', 'c') + marker(2, 'test-start', 'd', 't'), 5)
    const context = tracker.context(5)
    expect(context.collectedNotStarted).toEqual(['c'])
    expect(context.inFlight.map((m) => m.module)).toEqual(['d'])
    expect(context.lastEnded).toBeNull()
  })

  it('ignores replayed, partial, foreign and invalid-sequence lines', () => {
    const tracker = new ProgressTracker(PREFIX)
    const first = marker(2, 'module-start', 'a')
    tracker.observe(`${first}[p] seq=3 event=module-end module="a`, 1)
    tracker.observe(
      `${first}${marker(1, 'module-start', 'old')}[q] seq=9 event=module-end module="a"\n`,
      2,
    )
    expect(tracker.context(2).recentMarkers.map((m) => m.seq)).toEqual([2])
    tracker.observe(`[p] seq=${'9'.repeat(30)} event=module-end module="a"\n`, 3)
    expect(tracker.context(3).inFlight.map((m) => m.module)).toEqual(['a'])
  })

  it('matches a prefix literally and keeps the raw text of a bad escape', () => {
    const tracker = new ProgressTracker('[a.b]')
    tracker.observe('[axb] seq=1 event=module-start module="x"\n', 0)
    tracker.observe('[a.b] seq=1 event=module-start module="bad\\u12"\r\n', 0)
    expect(tracker.context(0).inFlight.map((m) => m.module)).toEqual(['bad\\u12'])
  })

  it('bounds the recent markers, tracked modules and reported modules', () => {
    const tracker = new ProgressTracker(PREFIX)
    for (let i = 1; i <= 100; i += 1) tracker.observe(marker(i, 'module-start', `m${i}`), i)
    const context = tracker.context(100)
    expect(context.recentMarkers.map((m) => m.seq)).toEqual([
      91, 92, 93, 94, 95, 96, 97, 98, 99, 100,
    ])
    expect(context.inFlight).toHaveLength(10)
    expect(context.inFlight[0]!.module).toBe('m37')
    for (let i = 101; i <= 170; i += 1) tracker.observe(marker(i, 'module-collected', `c${i}`), i)
    expect(tracker.context(170).collectedNotStarted).toHaveLength(10)
  })
})
