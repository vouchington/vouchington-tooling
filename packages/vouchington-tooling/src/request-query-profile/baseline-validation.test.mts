import { describe, expect, it } from 'vitest'

import { baselineEntryProblem } from './baseline-validation.mts'

const base = { annotation: 'a:b', reason: 'why', routes: ['GET /x'], maxCount: 2 }
const temporary = { ...base, issue: 5 }
const permanent = { ...base, permanent: true, code: 'src/a.ts:12' }

describe('baselineEntryProblem', () => {
  it('accepts temporary and permanent entries', () => {
    expect(baselineEntryProblem(temporary)).toBeUndefined()
    expect(baselineEntryProblem({ ...temporary, maxCount: null })).toBeUndefined()
    expect(baselineEntryProblem(permanent)).toBeUndefined()
    expect(
      baselineEntryProblem({
        ...temporary,
        routes: ['POST /mcp tools/call do_it'],
        workers: [{ queue: 'q', job: 'j' }],
      }),
    ).toBeUndefined()
    expect(
      baselineEntryProblem({ ...temporary, routes: [], workers: [{ queue: 'q', job: 'j' }] }),
    ).toBeUndefined()
  })

  it('rejects non-objects and missing text fields', () => {
    expect(baselineEntryProblem(null)).toBe('is not an object')
    expect(baselineEntryProblem('x')).toBe('is not an object')
    expect(baselineEntryProblem({ ...temporary, annotation: ' ' })).toBe(
      'needs a non-empty annotation',
    )
    expect(baselineEntryProblem({ ...temporary, annotation: 1 })).toBe(
      'needs a non-empty annotation',
    )
    expect(baselineEntryProblem({ ...temporary, reason: '' })).toBe('needs a non-empty reason')
    expect(baselineEntryProblem({ ...temporary, reason: 3 })).toBe('needs a non-empty reason')
  })

  it('rejects malformed routes', () => {
    const message = 'needs `routes` as an array of exact method and path identities without queries'
    expect(baselineEntryProblem({ ...temporary, routes: 'GET /x' })).toBe(message)
    expect(baselineEntryProblem({ ...temporary, routes: [1] })).toBe(message)
    expect(baselineEntryProblem({ ...temporary, routes: ['GET /x?a=1'] })).toBe(message)
    expect(baselineEntryProblem({ ...temporary, routes: ['get /x'] })).toBe(message)
  })

  it('rejects malformed workers', () => {
    const message = 'needs `workers` as exact { queue, job } identities'
    const withWorkers = (workers: unknown) => baselineEntryProblem({ ...temporary, workers })
    expect(withWorkers('q')).toBe(message)
    expect(withWorkers([null])).toBe(message)
    expect(withWorkers([{ queue: 'q', job: 'j', extra: 1 }])).toBe(message)
    expect(withWorkers([{ queue: 1, job: 'j' }])).toBe(message)
    expect(withWorkers([{ queue: ' ', job: 'j' }])).toBe(message)
    expect(withWorkers([{ queue: 'q*', job: 'j' }])).toBe(message)
    expect(withWorkers([{ queue: 'q', job: 1 }])).toBe(message)
    expect(withWorkers([{ queue: 'q', job: '' }])).toBe(message)
    expect(withWorkers([{ queue: 'q', job: 'j*' }])).toBe(message)
  })

  it('requires at least one identity', () => {
    const message = 'needs at least one route or worker identity'
    expect(baselineEntryProblem({ ...temporary, routes: [] })).toBe(message)
    expect(baselineEntryProblem({ ...temporary, routes: [], workers: [] })).toBe(message)
  })

  it('validates maxCount', () => {
    const message = 'needs `maxCount` as an integer at least 2, or null'
    expect(baselineEntryProblem({ ...temporary, maxCount: 1 })).toBe(message)
    expect(baselineEntryProblem({ ...temporary, maxCount: 2.5 })).toBe(message)
    expect(baselineEntryProblem({ ...temporary, maxCount: undefined })).toBe(message)
  })

  it('validates temporary issue numbers', () => {
    const message = 'needs `issue` to be a positive issue number'
    expect(baselineEntryProblem({ ...temporary, issue: 0 })).toBe(message)
    expect(baselineEntryProblem({ ...temporary, issue: '5' })).toBe(message)
    expect(baselineEntryProblem({ ...temporary, issue: 1.5 })).toBe(message)
  })

  it('validates permanent entries', () => {
    const message = 'needs `code` as "<repo path>:<line or symbol>"'
    expect(baselineEntryProblem({ ...permanent, permanent: false })).toBe('needs `permanent: true`')
    for (const code of [1, 'nocolon', '/abs/a.ts:1', 'a/../b.ts:1', 'a.ts:9-3', 'a.ts:0']) {
      expect(baselineEntryProblem({ ...permanent, code })).toBe(message)
    }
    expect(baselineEntryProblem({ ...permanent, code: 'a.ts:3-9' })).toBeUndefined()
    expect(baselineEntryProblem({ ...permanent, code: 'a.ts:Class.method' })).toBeUndefined()
  })

  it('rejects mixed or unknown metadata', () => {
    const message =
      'must be temporary { annotation, reason, issue } or permanent { annotation, reason, permanent: true, code }'
    expect(baselineEntryProblem(base)).toBe(message)
    expect(baselineEntryProblem({ ...temporary, code: 'a.ts:1' })).toBe(message)
    expect(baselineEntryProblem({ ...temporary, other: 1 })).toBe(message)
  })
})
