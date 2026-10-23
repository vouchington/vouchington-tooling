import { describe, expect, it } from 'vitest'
import { createClassifier } from './classify.mts'
import { layoutConfig } from './layout.test-helpers.mts'
import { createPathPolicy } from './paths.mts'
import { compilePatterns, normalizePath } from './patterns.mts'
import { buildRows, formatRows } from './rows.mts'

describe('compilePatterns', () => {
  it('matches basenames anywhere, prefixes, and full-path globs', () => {
    const matches = compilePatterns(['*.test.*', 'docs/', 'a/b', '**/__x__/**', '.hidden'])
    expect(matches('deep/dir/a.test.ts')).toBe(true)
    expect(matches('docs/guide.md')).toBe(true)
    expect(matches('docs')).toBe(true)
    expect(matches('a/b')).toBe(true)
    expect(matches('a/b/c.ts')).toBe(true)
    expect(matches('a/bc')).toBe(false)
    expect(matches('x/__x__/y.ts')).toBe(true)
    expect(matches('x/.hidden')).toBe(true)
    expect(matches('src/main.ts')).toBe(false)
    expect(compilePatterns([])('anything')).toBe(false)
  })

  it('normalizes separators and a leading ./', () => {
    expect(normalizePath('./a/b.ts')).toBe('a/b.ts')
  })
})

describe('createClassifier', () => {
  const classify = createClassifier(layoutConfig())

  it.each([
    ['api/src/a.ts', 'source', 'api'],
    ['api/src/a.test.ts', 'tests', 'api'],
    ['ui/x/__tests__/a.ts', 'tests', 'ui'],
    ['e2e/flow.ts', 'tests', 'ui'],
    ['api/scripts/run.ts', 'tooling', 'api'],
    ['scripts/run.ts', 'tooling', 'tooling'],
    ['./docs/guide.md', 'source', 'docs'],
    ['README.md', 'source', 'docs'],
    ['package.json', 'tooling', 'tooling'],
    ['vitest.config.mts', 'tooling', 'tooling'],
    ['loose.ts', 'source', 'tooling'],
  ])('classifies %s as %s in %s', (file, category, service) => {
    expect(classify(file)).toEqual({ category, service })
  })
})

describe('createPathPolicy', () => {
  const policy = createPathPolicy(layoutConfig())
  const tracked = new Set([
    'api/a.ts',
    'api/fixtures/f.ts',
    'api/__snapshots__/s.snap',
    'fixtures/top.ts',
    'README.md',
    'other/x.ts',
    'package.json',
  ])

  it('counts roots and root files but not ignored or untracked paths', () => {
    expect(policy.shouldCountFile('api/a.ts', tracked)).toBe(true)
    expect(policy.shouldCountFile('README.md', tracked)).toBe(true)
    expect(policy.shouldCountFile('api/fixtures/f.ts', tracked)).toBe(false)
    expect(policy.shouldCountFile('api/__snapshots__/s.snap', tracked)).toBe(false)
    expect(policy.shouldCountFile('fixtures/top.ts', tracked)).toBe(false)
    expect(policy.shouldCountFile('other/x.ts', tracked)).toBe(false)
    expect(policy.shouldCountFile('api/untracked.ts', tracked)).toBe(false)
    expect(policy.isCountedPath('api')).toBe(true)
    expect(policy.isCountedPath('apix/a.ts')).toBe(false)
  })

  it('hands scc only targets that exist', () => {
    expect(policy.countTargetsFor(tracked)).toEqual(['api', 'README.md', 'package.json'])
  })

  it('counts everything from the root when no roots are configured', () => {
    const all = createPathPolicy(layoutConfig({ countedRoots: [], countedRootFiles: [] }))
    expect(all.countTargetsFor(tracked)).toEqual(['.'])
    expect(all.shouldCountFile('other/x.ts', tracked)).toBe(true)
  })
})

describe('buildRows and formatRows', () => {
  const config = layoutConfig({ categories: { tests: 'specs' } })
  const rows = buildRows(
    [
      { path: 'api/a.ts', code: 10 },
      { path: 'api/a.test.ts', code: 5 },
      { path: 'scripts/x.ts', code: 3 },
      { path: 'stray.ts', code: 1 },
    ],
    config,
  )

  it('orders rows by service then total, with zero rows kept', () => {
    expect(rows.map((row) => row.service)).toEqual(['api', 'ui', 'docs', 'tooling', 'total'])
    expect(rows[0]).toEqual({
      service: 'api',
      counts: { source: 10, specs: 5, tooling: 0 },
      total: 15,
    })
    expect(rows[1]?.total).toBe(0)
    expect(rows.at(-1)).toEqual({
      service: 'total',
      counts: { source: 11, specs: 5, tooling: 3 },
      total: 19,
    })
  })

  it('formats an aligned table', () => {
    expect(formatRows(rows, config).split('\n')).toEqual([
      'service  source  specs  tooling  total',
      '-------  ------  -----  -------  -----',
      'api          10      5        0     15',
      'ui            0      0        0      0',
      'docs          0      0        0      0',
      'tooling       1      0        3      4',
      'total        11      5        3     19',
    ])
  })

  it('tolerates a row missing a category count', () => {
    const sparse = [{ service: 'x', counts: {}, total: 0 }]
    expect(formatRows(sparse, config)).toContain('x')
  })
})
