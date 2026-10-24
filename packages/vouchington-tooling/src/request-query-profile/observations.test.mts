import { describe, expect, it } from 'vitest'

import { collectProfileObservations } from './observations.mts'

const identity = (route: string) => route
const requestLine = (route: string, repeats: string) =>
  `[pg-request-profile] route=${route} queries=2 serialDepth=1 repeats=${repeats}`
const worker = (profile: unknown) => JSON.stringify({ kind: 'pg-worker-profile', profile })
const goodProfile = {
  identity: { queue: 'q', jobs: [{ name: 'j1' }, { name: 'j2' }] },
  summary: { repeats: [{ annotation: 'a', count: 2 }] },
}

describe('collectProfileObservations', () => {
  it('collects request scopes through the injected resolver', () => {
    const observed = collectProfileObservations(
      [`${requestLine('GET /orders/1', 'a(x2),b(x3)')}\n${requestLine('GET /ok', 'none')}\nnoise`],
      (route) => route.replace('/1', '/:id'),
    )
    expect(observed.requestProfileCount).toBe(2)
    expect([...observed.routeScopes]).toEqual([
      JSON.stringify(['a', 'GET /orders/:id']),
      JSON.stringify(['b', 'GET /orders/:id']),
    ])
  })

  it('counts malformed request lines', () => {
    const observed = collectProfileObservations(
      [requestLine('GET /x', 'a(x1)'), '[pg-request-profile] junk'],
      identity,
    )
    expect(observed.malformedRequestProfileCount).toBe(2)
    expect(observed.requestProfileCount).toBe(0)
  })

  it('collects worker scopes for every job, including nested children', () => {
    const child = { ...goodProfile, identity: { queue: 'q2', jobs: [{ name: 'k' }] } }
    const observed = collectProfileObservations(
      [`log prefix ${worker({ ...goodProfile, children: [child] })}`],
      identity,
    )
    expect(observed.workerProfileCount).toBe(2)
    expect(observed.malformedWorkerProfileCount).toBe(0)
    expect([...observed.workerScopes].sort()).toEqual(
      [
        JSON.stringify(['a', 'q', 'j1']),
        JSON.stringify(['a', 'q', 'j2']),
        JSON.stringify(['a', 'q2', 'k']),
      ].sort(),
    )
  })

  it('counts malformed worker lines', () => {
    const bad = (profile: unknown) =>
      collectProfileObservations([worker(profile)], identity).malformedWorkerProfileCount
    expect(
      collectProfileObservations(['"kind":"pg-worker-profile"'], identity)
        .malformedWorkerProfileCount,
    ).toBe(1)
    expect(
      collectProfileObservations(['{ "kind":"pg-worker-profile" nope'], identity)
        .malformedWorkerProfileCount,
    ).toBe(1)
    expect(
      collectProfileObservations(['{"kind":"pg-worker-profile"}'], identity)
        .malformedWorkerProfileCount,
    ).toBe(1)
    expect(bad(null)).toBe(1)
    expect(bad([])).toBe(1)
    expect(bad({ ...goodProfile, identity: { queue: ' ', jobs: [{ name: 'j' }] } })).toBe(1)
    expect(bad({ ...goodProfile, identity: { queue: 'q', jobs: [] } })).toBe(1)
    expect(bad({ ...goodProfile, identity: { queue: 'q', jobs: [{ name: ' ' }] } })).toBe(1)
    expect(bad({ ...goodProfile, identity: { queue: 'q', jobs: [null] } })).toBe(1)
    expect(bad({ ...goodProfile, identity: { queue: 'q' } })).toBe(1)
    expect(bad({ ...goodProfile, summary: {} })).toBe(1)
    expect(bad({ ...goodProfile, summary: { repeats: [{ annotation: 'a', count: 1 }] } })).toBe(1)
    expect(bad({ ...goodProfile, summary: { repeats: [{ annotation: ' ', count: 2 }] } })).toBe(1)
    expect(bad({ ...goodProfile, summary: { repeats: [null] } })).toBe(1)
    expect(bad({ ...goodProfile, children: [null] })).toBe(1)
    expect(bad({ ...goodProfile, children: 'x' })).toBe(1)
  })

  it('accepts empty repeats and rejects a wrong kind', () => {
    const empty = { ...goodProfile, summary: { repeats: [] } }
    const observed = collectProfileObservations([worker(empty)], identity)
    expect(observed.workerProfileCount).toBe(1)
    expect(observed.workerScopes.size).toBe(0)
    const wrong = '{"kind":"pg-worker-profile","kind":"other"}'
    expect(collectProfileObservations([wrong], identity).malformedWorkerProfileCount).toBe(1)
  })
})
