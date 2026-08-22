import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CURSOR_INCLUDE,
  matchesCursorFile,
  resolveCursorContractOptions,
} from './postgres-cursor-options.mts'
import type { RuleContextLike } from './ast-helpers.mts'

const base = { modules: ['@db/cursors'], executors: ['runCursor'] }

function context(filename: string, cwd = '/repo'): RuleContextLike {
  return {
    filename,
    cwd,
    options: [],
    report: () => {},
    sourceCode: { getScope: () => ({ upper: null }) },
  }
}

describe('resolveCursorContractOptions', () => {
  it('returns null when required fields are missing or invalid', () => {
    expect(resolveCursorContractOptions(undefined)).toBeNull()
    expect(resolveCursorContractOptions(null)).toBeNull()
    expect(resolveCursorContractOptions([])).toBeNull()
    expect(resolveCursorContractOptions({})).toBeNull()
    expect(resolveCursorContractOptions({ modules: ['@db/cursors'] })).toBeNull()
    expect(resolveCursorContractOptions({ executors: ['runCursor'] })).toBeNull()
    expect(resolveCursorContractOptions({ modules: [], executors: ['runCursor'] })).toBeNull()
    expect(resolveCursorContractOptions({ modules: ['@db/cursors'], executors: [] })).toBeNull()
    expect(resolveCursorContractOptions({ modules: 'x', executors: ['runCursor'] })).toBeNull()
    expect(resolveCursorContractOptions({ ...base, include: [1] })).toBeNull()
    expect(resolveCursorContractOptions({ ...base, exclude: {} })).toBeNull()
    expect(resolveCursorContractOptions({ ...base, includeFiles: [1] })).toBeNull()
    expect(resolveCursorContractOptions({ ...base, annotation: 1 })).toBeNull()
    expect(resolveCursorContractOptions({ ...base, annotation: '[' })).toBeNull()
  })

  it('applies defaults and compiles the annotation regex', () => {
    const resolved = resolveCursorContractOptions({
      ...base,
      includeFiles: ['./lib/seed.js'],
    })
    expect(resolved?.include).toEqual(DEFAULT_CURSOR_INCLUDE)
    expect(resolved?.exclude).toEqual([])
    expect(resolved?.includeFiles).toEqual(['lib/seed.js'])
    expect(resolved?.annotation.test('/* rows */ SELECT 1')).toBe(true)
    expect(resolved?.annotation.test('SELECT 1')).toBe(false)
    expect(
      resolveCursorContractOptions({ ...base, include: [], exclude: ['**/*.test.js'] })?.include,
    ).toEqual([])
    expect(
      resolveCursorContractOptions({ ...base, annotation: '^ok' })?.annotation.test('ok'),
    ).toBe(true)
  })
})

describe('matchesCursorFile', () => {
  const options = resolveCursorContractOptions({
    ...base,
    exclude: ['**/*.test.js', '**/test-helpers/**'],
    includeFiles: ['lib/test-helpers/seed.js'],
  })
  if (!options) throw new Error('expected options')

  it('includes exact allowlisted paths even when exclude matches', () => {
    expect(matchesCursorFile(context('/repo/lib/test-helpers/seed.js'), options)).toBe(true)
    expect(matchesCursorFile(context('/repo/src/service.test.js'), options)).toBe(false)
    expect(matchesCursorFile(context('/repo/src/service.js'), options)).toBe(true)
    expect(matchesCursorFile(context('/repo/README.md'), options)).toBe(false)
  })

  it('matches default extension globs including root files', () => {
    const defaults = resolveCursorContractOptions(base)
    if (!defaults) throw new Error('expected defaults')
    expect(matchesCursorFile(context('/repo/service.mts'), defaults)).toBe(true)
    expect(
      matchesCursorFile(
        {
          filename: 'service.js',
          options: [],
          report: () => {},
          sourceCode: { getScope: () => ({ upper: null }) },
        },
        defaults,
      ),
    ).toBe(true)
  })
})
