import { describe, expect, it } from 'vitest'
import { sourceFiltersWithPublicBoundary } from './public-boundary.mts'
import type { ReaderSourceAnalysisOptions } from './source-options.mts'

const options: ReaderSourceAnalysisOptions = {
  canonicalImports: new Map([
    ['buildFilter', new Set(['@fixture/builders'])],
    ['buildAccess', new Set(['./access.mts'])],
    ['buildPublicFilter', new Set(['@fixture/builders'])],
    ['collectVisibleIds', new Set(['@fixture/boundary'])],
    ['loadDescendants', new Set(['@fixture/descendants'])],
    ['loadVisibleDescendants', new Set(['./visible-ids.mts'])],
  ]),
  sql: {
    templateTag: 'sql',
    appendMethod: 'append',
    placeholderPrefix: 'fixture_',
    executorImports: new Map([
      ['@fixture/database', new Set(['read', 'write', 'query', 'readStream', 'explainAnalyze'])],
    ]),
  },
  ignoredCall: 'ignore',
  candidateIdProperty: 'id',
}
describe('post-publication public-boundary validation', () => {
  it('accepts public IDs used to filter the emitted candidates', () => {
    const errors = sourceFiltersWithPublicBoundary(
      `import { collectVisibleIds } from '@fixture/boundary'
const selectedIds = await collectVisibleIds(results.map(result => result.id))
return results.filter(result => selectedIds.has(result.id))`,
      ['collectVisibleIds'],
      options,
    )
    expect(errors).toBe(true)
  })

  it('accepts a chained public-ID filter', () => {
    const errors = sourceFiltersWithPublicBoundary(
      `import { collectVisibleIds } from '@fixture/boundary'
return collectVisibleIds(results.map(result => result.id)).then(selectedIds =>
  results.filter(result => selectedIds.has(result.id)),
)`,
      ['collectVisibleIds'],
      options,
    )
    expect(errors).toBe(true)
  })

  it('rejects irrelevant property access on public IDs', () => {
    const errors = sourceFiltersWithPublicBoundary(
      `import { collectVisibleIds } from '@fixture/boundary'
const selectedIds = await collectVisibleIds(candidateIds)
selectedIds.size
return candidateIds`,
      ['collectVisibleIds'],
      options,
    )
    expect(errors).toBe(false)
  })

  it('rejects passing public IDs to an unrelated call', () => {
    const errors = sourceFiltersWithPublicBoundary(
      `import { collectVisibleIds } from '@fixture/boundary'
const selectedIds = await collectVisibleIds(candidateIds)
log(selectedIds)
return candidateIds`,
      ['collectVisibleIds'],
      options,
    )
    expect(errors).toBe(false)
  })

  it('rejects a shadowed public-ID binding used by a filter', () => {
    const errors = sourceFiltersWithPublicBoundary(
      `import { collectVisibleIds } from '@fixture/boundary'
const selectedIds = await collectVisibleIds(candidateIds)
const visible = results.filter(selectedIds => selectedIds.has('unrelated'))
return visible`,
      ['collectVisibleIds'],
      options,
    )
    expect(errors).toBe(false)
  })

  it('rejects an unused filtered derivation before the original candidates are returned', () => {
    const errors = sourceFiltersWithPublicBoundary(
      `import { collectVisibleIds } from '@fixture/boundary'
const selectedIds = await collectVisibleIds(candidateIds)
const unused = results.filter(result => selectedIds.has(result.id))
return results`,
      ['collectVisibleIds'],
      options,
    )
    expect(errors).toBe(false)
  })

  it('rejects an irrelevant conditional check before returning original candidates', () => {
    const errors = sourceFiltersWithPublicBoundary(
      `import { collectVisibleIds } from '@fixture/boundary'
const selectedIds = await collectVisibleIds(candidateIds)
if (selectedIds.has('unrelated')) log('irrelevant')
return results`,
      ['collectVisibleIds'],
      options,
    )
    expect(errors).toBe(false)
  })

  it('rejects a map that returns unchanged candidates', () => {
    const errors = sourceFiltersWithPublicBoundary(
      `import { collectVisibleIds } from '@fixture/boundary'
const selectedIds = await collectVisibleIds(candidateIds)
return results.map(result => {
  selectedIds.has(result.id)
  return result
})`,
      ['collectVisibleIds'],
      options,
    )
    expect(errors).toBe(false)
  })

  it('rejects an unused secondary transformation of filtered candidates', () => {
    const errors = sourceFiltersWithPublicBoundary(
      `import { collectVisibleIds } from '@fixture/boundary'
const selectedIds = await collectVisibleIds(candidateIds)
const filtered = results.filter(result => selectedIds.has(result.id))
const unused = filtered.map(result => result.id)
return results`,
      ['collectVisibleIds'],
      options,
    )
    expect(errors).toBe(false)
  })

  it('rejects an assertion unrelated to the emitted candidates', () => {
    const errors = sourceFiltersWithPublicBoundary(
      `import { collectVisibleIds } from '@fixture/boundary'
const selectedIds = await collectVisibleIds(candidateIds)
ctx.assert(selectedIds.has('unrelated'))
return results`,
      ['collectVisibleIds'],
      options,
    )
    expect(errors).toBe(false)
  })

  it('rejects merely inspecting a filtered derivation', () => {
    const errors = sourceFiltersWithPublicBoundary(
      `import { collectVisibleIds } from '@fixture/boundary'
const selectedIds = await collectVisibleIds(candidateIds)
const filtered = results.filter(result => selectedIds.has(result.id))
if (filtered[0]) log(filtered[0])
return results`,
      ['collectVisibleIds'],
      options,
    )
    expect(errors).toBe(false)
  })

  it('rejects a chained boundary callback that discards its check', () => {
    const errors = sourceFiltersWithPublicBoundary(
      `import { collectVisibleIds } from '@fixture/boundary'
return collectVisibleIds(candidateIds).then(selectedIds => {
  selectedIds.has(results[0].id)
  return results
})`,
      ['collectVisibleIds'],
      options,
    )
    expect(errors).toBe(false)
  })
})
