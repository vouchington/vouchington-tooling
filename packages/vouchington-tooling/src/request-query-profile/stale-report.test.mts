import { describe, expect, it } from 'vitest'

import { parseRepeatBaseline } from './baseline.mts'
import { buildStaleReport, findStaleBaselineEntries } from './stale-report.mts'

const routeEntry = {
  annotation: 'a',
  reason: 'r',
  routes: ['GET /one', 'GET /two'],
  maxCount: 2,
  issue: 1,
}
const workerEntry = {
  annotation: 'w',
  reason: 'r',
  routes: [],
  workers: [{ queue: 'q', job: 'j' }],
  maxCount: null,
  issue: 2,
}
const baseline = parseRepeatBaseline([routeEntry, workerEntry])
const requestLog = (route: string, repeats = 'a(x2)') =>
  `[pg-request-profile] route=${route} queries=2 serialDepth=1 repeats=${repeats}`
const workerLog = (repeats: Array<{ annotation: string; count: number }>) =>
  JSON.stringify({
    kind: 'pg-worker-profile',
    profile: { identity: { queue: 'q', jobs: [{ name: 'j' }] }, summary: { repeats } },
  })
const identity = (route: string) => route

describe('buildStaleReport', () => {
  it('reports only scopes absent from complete logs', () => {
    const report = buildStaleReport(
      baseline,
      [`${requestLog('GET /one')}\n${workerLog([{ annotation: 'w', count: 2 }])}`],
      identity,
    )
    expect(report).toMatchObject({
      logCount: 1,
      requestProfileCount: 1,
      workerProfileCount: 1,
      sufficient: true,
    })
    expect(report.stale).toEqual([
      { index: 0, entry: { ...routeEntry, routes: ['GET /two'] }, fullyStale: false },
    ])
  })

  it('reports fully stale entries', () => {
    const report = buildStaleReport(
      baseline,
      [`${requestLog('GET /other')}\n${workerLog([])}`],
      identity,
    )
    expect(report.sufficient).toBe(true)
    expect(report.stale.map(({ index, fullyStale }) => [index, fullyStale])).toEqual([
      [0, true],
      [1, true],
    ])
  })

  it('never treats a missing diagnostic kind as evidence of absence', () => {
    const report = buildStaleReport(baseline, [requestLog('GET /one')], identity)
    expect(report.sufficient).toBe(false)
    expect(report.stale).toEqual([
      { index: 0, entry: { ...routeEntry, routes: ['GET /two'] }, fullyStale: false },
    ])
  })

  it('never treats malformed diagnostics as evidence of absence', () => {
    const report = buildStaleReport(
      baseline,
      [`${requestLog('GET /one')}\n[pg-request-profile] junk\n{"kind":"pg-worker-profile"}`],
      identity,
    )
    expect(report.sufficient).toBe(false)
    expect(report).toMatchObject({
      malformedRequestProfileCount: 1,
      malformedWorkerProfileCount: 1,
    })
    expect(report.stale).toEqual([])
  })

  it('is insufficient with no logs, and only requires kinds the baseline uses', () => {
    expect(buildStaleReport(baseline, [], identity).sufficient).toBe(false)
    expect(buildStaleReport(baseline, ['quiet'], identity).sufficient).toBe(false)
    const routesOnly = parseRepeatBaseline([routeEntry])
    expect(buildStaleReport(routesOnly, [requestLog('GET /one')], identity).sufficient).toBe(true)
    const workersOnly = parseRepeatBaseline([workerEntry])
    expect(buildStaleReport(workersOnly, [workerLog([])], identity).sufficient).toBe(true)
  })
})

describe('findStaleBaselineEntries', () => {
  it('keeps entries without workers free of a workers key', () => {
    const stale = findStaleBaselineEntries(baseline, new Set(), new Set())
    expect(stale[0]?.entry).not.toHaveProperty('workers')
    expect(stale[1]?.entry).toHaveProperty('workers', [{ queue: 'q', job: 'j' }])
  })

  it('omits entries whose scopes are all observed', () => {
    const routes = new Set([JSON.stringify(['a', 'GET /one']), JSON.stringify(['a', 'GET /two'])])
    const workers = new Set([JSON.stringify(['w', 'q', 'j'])])
    expect(findStaleBaselineEntries(baseline, routes, workers)).toEqual([])
  })
})
