import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadClocConfig } from './config-load.mts'
import { DEFAULT_EXCLUDED_DIRS, DEFAULT_IGNORED_DIRS, normalizeClocConfig } from './config.mts'

describe('normalizeClocConfig', () => {
  it('fills defaults for an empty config', () => {
    expect(normalizeClocConfig({})).toEqual({
      services: [{ name: 'other', match: [] }],
      defaultService: 'other',
      categories: { source: 'source', tests: 'tests', tooling: 'tooling' },
      testPatterns: [],
      toolingPatterns: [],
      countedRoots: [],
      countedRootFiles: [],
      excludedDirs: DEFAULT_EXCLUDED_DIRS,
      ignoredDirs: DEFAULT_IGNORED_DIRS,
    })
  })

  it('keeps a default service that is already listed and carries every override', () => {
    const config = normalizeClocConfig({
      services: [{ name: 'a', match: ['a/'] }, { name: 'rest' }],
      defaultService: 'rest',
      categories: { tests: 'specs' },
      excludedDirs: ['x'],
      ignoredDirs: [],
      sccBin: '/bin/scc',
      missingSccHint: 'install it',
    })
    expect(config.services.map((rule) => rule.name)).toEqual(['a', 'rest'])
    expect(config.categories.tests).toBe('specs')
    expect(config).toMatchObject({
      excludedDirs: ['x'],
      ignoredDirs: [],
      sccBin: '/bin/scc',
      missingSccHint: 'install it',
    })
  })

  it.each([
    [null, 'must be an object'],
    [[], 'must be an object'],
    [{ services: 'x' }, '"services" must be an array'],
    [{ services: [{ match: [] }] }, '"services[0].name" is required'],
    [{ services: [null] }, '"services[0].name" is required'],
    [{ services: [{ name: 'a', match: 'a/' }] }, '"services[0].match" must be an array'],
    [{ testPatterns: [''] }, '"testPatterns" must be an array'],
    [{ defaultService: '' }, '"defaultService" must be a non-empty string'],
    [{ services: [{ name: 'a' }, { name: 'a' }] }, 'duplicate service "a"'],
    [{ defaultService: 'total' }, '"total" is reserved'],
    [{ categories: { tests: 'source' } }, 'category names must be distinct'],
    [{ categories: { source: 'total' } }, 'not "service" or "total"'],
    [{ categories: { tooling: 'service' } }, 'not "service" or "total"'],
    [{ sccBin: 3 }, '"sccBin" must be a non-empty string'],
  ])('rejects %j', (raw, message) => {
    expect(() => normalizeClocConfig(raw)).toThrow(message)
  })
})

describe('loadClocConfig', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cloc-config-'))

  it('reads a json file relative to the working directory', async () => {
    writeFileSync(join(dir, 'layout.json'), JSON.stringify({ defaultService: 'misc' }))
    expect((await loadClocConfig('layout.json', dir)).defaultService).toBe('misc')
  })

  it('imports a module and prefers the config export over default', async () => {
    const seen: string[] = []
    const load = async (specifier: string) => {
      seen.push(specifier)
      return { config: { defaultService: 'named' }, default: { defaultService: 'plain' } }
    }
    expect((await loadClocConfig('layout.mts', dir, load)).defaultService).toBe('named')
    expect(seen[0]).toBe(`file://${join(dir, 'layout.mts')}`)
  })

  it('accepts a default export or a function', async () => {
    const plain = async () => ({ default: { defaultService: 'plain' } })
    expect((await loadClocConfig('l.mjs', dir, plain)).defaultService).toBe('plain')
    const fn = async () => ({ default: async () => ({ defaultService: 'fn' }) })
    expect((await loadClocConfig('l.mjs', dir, fn)).defaultService).toBe('fn')
  })

  it('imports a real module by default', async () => {
    writeFileSync(join(dir, 'real.mjs'), "export default { defaultService: 'real' }\n")
    expect((await loadClocConfig('real.mjs', dir)).defaultService).toBe('real')
  })
})
