import { describe, expect, it } from 'vitest'

import {
  findUnbaselinedRepeats,
  formatClosedBaselineIssues,
  formatUnbaselinedRepeats,
  parseRepeatBaseline,
  temporaryBaselineEntries,
  type RepeatBaselineEntry,
} from './baseline.mts'

const temporary = {
  annotation: 'orders:load',
  reason: 'why',
  routes: ['GET /orders/:id'],
  maxCount: 3,
  issue: 12,
}
const permanent = {
  annotation: 'users:load',
  reason: 'needed',
  routes: ['GET /users'],
  maxCount: null,
  permanent: true,
  code: 'src/users.ts:10',
}

describe('parseRepeatBaseline', () => {
  it('returns valid entries', () => {
    const raw = [temporary, permanent]
    expect(parseRepeatBaseline(raw)).toBe(raw)
  })

  it('requires an array', () => {
    expect(() => parseRepeatBaseline({})).toThrow(
      'Query-profile baseline must be an array of entries',
    )
  })

  it('names every malformed entry', () => {
    expect(() => parseRepeatBaseline([{ ...temporary, issue: 0 }, null, 'x'])).toThrow(
      [
        'Malformed query-profile baseline:',
        'entry 0 ("orders:load") needs `issue` to be a positive issue number',
        'entry 1 (undefined) is not an object',
        'entry 2 (undefined) is not an object',
      ].join('\n'),
    )
  })

  it('rejects duplicate route and worker scopes', () => {
    const worker = { ...temporary, routes: [], workers: [{ queue: 'q', job: 'j' }] }
    expect(() =>
      parseRepeatBaseline([temporary, { ...temporary, issue: 13 }, worker, worker]),
    ).toThrow(/entry 1 \("orders:load"\) has a duplicate scope \["orders:load","route"/)
    expect(() => parseRepeatBaseline([worker, worker])).toThrow(
      /entry 1 .* has a duplicate scope \["orders:load","worker","q","j"\]/,
    )
  })

  it('allows the same route under different annotations', () => {
    expect(() =>
      parseRepeatBaseline([temporary, { ...temporary, annotation: 'other' }]),
    ).not.toThrow()
  })
})

describe('temporaryBaselineEntries', () => {
  it('keeps entries with an issue', () => {
    const baseline = parseRepeatBaseline([temporary, permanent])
    expect(temporaryBaselineEntries(baseline)).toEqual([temporary])
  })
})

describe('findUnbaselinedRepeats', () => {
  const baseline = parseRepeatBaseline([temporary, permanent]) as RepeatBaselineEntry[]

  it('allows repeats within scope and maximum', () => {
    const repeats = [{ annotation: 'orders:load', count: 3 }]
    expect(findUnbaselinedRepeats('GET /orders/:id', repeats, baseline)).toEqual([])
    expect(
      findUnbaselinedRepeats('GET /users', [{ annotation: 'users:load', count: 99 }], baseline),
    ).toEqual([])
  })

  it('reports repeats over the maximum, on other routes, or unknown, in order', () => {
    const repeats = [
      { annotation: 'orders:load', count: 4 },
      { annotation: 'other', count: 2 },
    ]
    expect(findUnbaselinedRepeats('GET /orders/:id', repeats, baseline)).toEqual(repeats)
    expect(
      findUnbaselinedRepeats('GET /elsewhere', [{ annotation: 'orders:load', count: 2 }], baseline),
    ).toHaveLength(1)
  })
})

describe('formatUnbaselinedRepeats', () => {
  it('names the route, repeats and baseline file', () => {
    const text = formatUnbaselinedRepeats(
      'GET /x',
      [
        { annotation: 'a', count: 2 },
        { annotation: 'b', count: 5 },
      ],
      { baselineFile: 'test/baseline.json' },
    )
    expect(text).toContain('Unbaselined repeated query in GET /x: a (x2), b (x5).')
    expect(text).toContain('baseline it in test/baseline.json with a reason')
  })
})

describe('formatClosedBaselineIssues', () => {
  const baseline = parseRepeatBaseline([
    temporary,
    { ...temporary, annotation: 'closed', routes: ['GET /c'], issue: 13 },
    { ...temporary, annotation: 'missing', routes: ['GET /m'], issue: 14 },
    permanent,
  ])
  const states = new Map([
    [12, 'OPEN'],
    [13, 'CLOSED'],
  ])

  it('reports temporary entries whose issue is not open', () => {
    const lines = formatClosedBaselineIssues(baseline, states, { issueGroup: 'Reductions' })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Baseline entry closed points at #13, which is closed.')
    expect(lines[0]).toContain('in "Reductions"')
    expect(lines[1]).toContain('Baseline entry missing points at #14, which is not found.')
  })
})
