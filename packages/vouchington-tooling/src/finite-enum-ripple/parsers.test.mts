import { describe, expect, it } from 'vitest'
import {
  parseUnionDetailRouteFactoryArgs,
  parseUnionRouteConfigEntries,
  parseUnionSlugToType,
  parseUnionTypeUnion,
  parseStructuredRouteConfigEntries,
  parseStructuredRouteFactoryArgs,
  parseStructuredTypeEntries,
} from './parsers.mts'

const file = 'src/catalog.ts'

describe('finite enum parsers', () => {
  it('parses compact and multiline objects without comment coupling', () => {
    const source = [
      "export const kinds = { alpha: { slug: 'alpha', slugs: 'alphas' },",
      "  /* beta: { slug: 'beta', slugs: 'betas' }, */",
      "  gamma: { slug: 'gamma', slugs: 'gammas' } } as const",
    ].join('\n')
    expect(parseStructuredTypeEntries(source, file, 'kinds', 'slug', 'slugs')).toEqual([
      { value: 'alpha', slug: 'alpha', slugPlural: 'alphas' },
      { value: 'gamma', slug: 'gamma', slugPlural: 'gammas' },
    ])
  })

  it('reports missing properties and malformed declarations', () => {
    expect(() =>
      parseStructuredTypeEntries(
        "const kinds = { alpha: { slug: 'alpha' } }",
        file,
        'kinds',
        'slug',
        'slugs',
      ),
    ).toThrow(`${file}: kinds.alpha is missing slugs`)
    expect(() =>
      parseStructuredTypeEntries(
        "const kinds = { alpha: { slug: 'alpha'",
        file,
        'kinds',
        'slug',
        'slugs',
      ),
    ).toThrow(`${file}: could not find end of kinds`)
    expect(() => parseUnionTypeUnion('type Other = 1', file, 'RecordKind')).toThrow(
      `${file}: could not parse RecordKind union`,
    )
  })

  it('extracts configured route objects and a union', () => {
    const source = [
      "const kindRoutes = { alphas: { singular: 'alpha', plural: 'alphas', kinds: ['alpha'] as string[], special: true } }",
      "const recordRoutes = { entries: { singular: 'entry', plural: 'entries', kinds: ['entry'] } }",
      "const recordSlugs = { entry: 'entry' } as const",
      "type RecordKind = 'entry' | ('internal')",
    ].join('\n')
    expect(
      parseStructuredRouteConfigEntries(
        source,
        file,
        'kindRoutes',
        'kinds',
        'special',
        'plural',
        'singular',
      ),
    ).toMatchObject([
      {
        key: 'alphas',
        singularPath: 'alpha',
        pluralPath: 'alphas',
        structuredTypes: ['alpha'],
        routeExempt: true,
      },
    ])
    expect(
      parseUnionRouteConfigEntries(source, file, 'recordRoutes', 'kinds', 'plural', 'singular'),
    ).toMatchObject([
      { key: 'entries', singularPath: 'entry', pluralPath: 'entries', unionTypes: ['entry'] },
    ])
    expect([...parseUnionSlugToType(source, file, 'recordSlugs')]).toEqual([['entry', 'entry']])
    expect(parseUnionTypeUnion(source, file, 'RecordKind')).toEqual(['entry', 'internal'])
  })

  it('rejects prototype setters in structured and union route maps', () => {
    for (const key of ['__proto__', "'__proto__'"]) {
      const routes = `const routes = { ${key}: { singular: '__proto__', plural: '__proto__', kinds: ['__proto__'] } }`
      expect(() =>
        parseUnionRouteConfigEntries(routes, file, 'routes', 'kinds', 'plural', 'singular'),
      ).toThrow('unsupported __proto__ prototype setter')
      expect(() =>
        parseStructuredRouteConfigEntries(
          routes,
          file,
          'routes',
          'kinds',
          'special',
          'plural',
          'singular',
        ),
      ).toThrow('unsupported __proto__ prototype setter')
    }
    const computed =
      "const routes = { ['__proto__']: { singular: 'entry', plural: 'entries', kinds: ['entry'] } }"
    expect(
      parseUnionRouteConfigEntries(computed, file, 'routes', 'kinds', 'plural', 'singular'),
    ).toHaveLength(1)
    expect(
      parseStructuredRouteConfigEntries(
        computed,
        file,
        'routes',
        'kinds',
        'special',
        'plural',
        'singular',
      ),
    ).toHaveLength(1)
  })

  it('accepts imported factory aliases and ignores unrelated calls', () => {
    const source = [
      "import { createRecordPage as pageFactory } from './factories'",
      "const Page = pageFactory('entry', 'entry')",
      "otherFactory('skip', 'skip')",
    ].join('\n')
    expect(parseUnionDetailRouteFactoryArgs(source, file, /^pageFactory$/)).toEqual([
      { unionType: 'entry', slug: 'entry' },
    ])
    expect(
      parseStructuredRouteFactoryArgs("const Page = pageFactory('alpha')", file, /^pageFactory$/),
    ).toEqual([{ slug: 'alpha' }])
  })

  it('rejects missing or non-object declarations with configured names', () => {
    expect(() =>
      parseStructuredTypeEntries('const other = {}', file, 'kinds', 'slug', 'slugs'),
    ).toThrow('could not find kinds')
    expect(() =>
      parseStructuredTypeEntries('const kinds = 1', file, 'kinds', 'slug', 'slugs'),
    ).toThrow('could not find kinds')
  })

  it('rejects uninspectable slug-map members and nonliteral values', () => {
    const source = "const recordSlugs = { 'entry': 'entry', 7: 'number' }"
    expect([...parseUnionSlugToType(source, file, 'recordSlugs')]).toEqual([
      ['entry', 'entry'],
      ['7', 'number'],
    ])
    expect(() =>
      parseUnionSlugToType("const recordSlugs = { entry: 'entry', ...extra }", file, 'recordSlugs'),
    ).toThrow('uninspectable member')
    expect(() =>
      parseUnionSlugToType(
        "const recordSlugs = { entry: 'entry', [dynamic]: 'other' }",
        file,
        'recordSlugs',
      ),
    ).toThrow('uninspectable key')
    expect(() =>
      parseUnionSlugToType('const recordSlugs = { other: false }', file, 'recordSlugs'),
    ).toThrow('recordSlugs.other must be a string literal')
    expect(() =>
      parseUnionSlugToType(
        "const recordSlugs = { entry: 'entry', draft: computeType() }",
        file,
        'recordSlugs',
      ),
    ).toThrow('recordSlugs.draft must be a string literal')
    expect(() => parseUnionSlugToType('const recordSlugs = {}', file, 'recordSlugs')).toThrow(
      'could not parse recordSlugs entries',
    )
  })

  it('rejects direct writes to the configured slug map but ignores shadowed locals', () => {
    for (const write of [
      "recordSlugs.entry = 'other'",
      "recordSlugs[dynamic] = 'other'",
      'delete recordSlugs.entry',
      'recordSlugs.entry++',
      '++recordSlugs.entry',
    ]) {
      expect(() =>
        parseUnionSlugToType(
          `const recordSlugs = { entry: 'entry' }; ${write}`,
          file,
          'recordSlugs',
        ),
      ).toThrow('post-declaration property mutation')
    }
    const shadowed =
      "const recordSlugs = { entry: 'entry' }; function update() { const recordSlugs = {}; recordSlugs.entry = 'other' }"
    expect([...parseUnionSlugToType(shadowed, file, 'recordSlugs')]).toEqual([['entry', 'entry']])
  })

  it('rejects direct mutations of configured route and structured maps', () => {
    for (const mutation of [
      "routes.entries = { singular: 'wrong', plural: 'entries', kinds: ['entry'] }",
      "routes.entries.singular = 'wrong'",
      'delete routes.entries',
      'delete routes.entries.singular',
      'routes.entries++',
      'routes.entries.singular++',
    ]) {
      const source =
        "const routes = { entries: { singular: 'entry', plural: 'entries', kinds: ['entry'] } }; " +
        mutation
      expect(() =>
        parseUnionRouteConfigEntries(source, file, 'routes', 'kinds', 'plural', 'singular'),
      ).toThrow('post-declaration property mutation')
      expect(() =>
        parseStructuredRouteConfigEntries(
          source,
          file,
          'routes',
          'kinds',
          'exempt',
          'plural',
          'singular',
        ),
      ).toThrow('post-declaration property mutation')
    }
    for (const mutation of [
      "kinds.alpha = { slug: 'wrong', slugs: 'alphas' }",
      "kinds.alpha.slug = 'wrong'",
      'delete kinds.alpha',
      'delete kinds.alpha.slug',
      'kinds.alpha++',
      'kinds.alpha.slug++',
    ]) {
      expect(() =>
        parseStructuredTypeEntries(
          `const kinds = { alpha: { slug: 'alpha', slugs: 'alphas' } }; ${mutation}`,
          file,
          'kinds',
          'slug',
          'slugs',
        ),
      ).toThrow('post-declaration property mutation')
    }
    const shadowedRoutes =
      "const routes = { entries: { singular: 'entry', plural: 'entries', kinds: ['entry'] } }; function update() { const routes = {}; routes.entries = {} }"
    expect(
      parseUnionRouteConfigEntries(shadowedRoutes, file, 'routes', 'kinds', 'plural', 'singular'),
    ).toHaveLength(1)
    const shadowedKinds =
      "const kinds = { alpha: { slug: 'alpha', slugs: 'alphas' } }; function update() { const kinds = {}; kinds.alpha = {} }"
    expect(parseStructuredTypeEntries(shadowedKinds, file, 'kinds', 'slug', 'slugs')).toEqual([
      { value: 'alpha', slug: 'alpha', slugPlural: 'alphas' },
    ])
    const shadowedNestedWrites =
      "const routes = { entries: { singular: 'entry', plural: 'entries', kinds: ['entry'] } }; const kinds = { alpha: { slug: 'alpha', slugs: 'alphas' } }; function update() { const routes = { entries: { singular: 'other' } }; const kinds = { alpha: { slug: 'other' } }; routes.entries.singular = 'changed'; kinds.alpha.slug = 'changed' }"
    expect(
      parseUnionRouteConfigEntries(
        shadowedNestedWrites,
        file,
        'routes',
        'kinds',
        'plural',
        'singular',
      ),
    ).toHaveLength(1)
    expect(
      parseStructuredTypeEntries(shadowedNestedWrites, file, 'kinds', 'slug', 'slugs'),
    ).toEqual([{ value: 'alpha', slug: 'alpha', slugPlural: 'alphas' }])
  })

  it('rejects prototype-setter slug keys and preserves caller regex state', () => {
    expect(() =>
      parseUnionSlugToType("const recordSlugs = { __proto__: 'entry' }", file, 'recordSlugs'),
    ).toThrow(/unsupported __proto__ prototype setter/)

    const unionPattern = /^pageFactory$/g
    unionPattern.lastIndex = 4
    const unionSource = "pageFactory('entry', 'entry'); pageFactory('other', 'other')"
    expect(parseUnionDetailRouteFactoryArgs(unionSource, file, unionPattern)).toEqual([
      { unionType: 'entry', slug: 'entry' },
      { unionType: 'other', slug: 'other' },
    ])
    expect(parseUnionDetailRouteFactoryArgs(unionSource, file, unionPattern)).toHaveLength(2)
    expect(unionPattern.lastIndex).toBe(4)

    const structuredPattern = Object.freeze(/^pageFactory$/g)
    expect(
      parseStructuredRouteFactoryArgs("pageFactory('alpha')", file, structuredPattern),
    ).toEqual([{ slug: 'alpha' }])
  })

  it('rejects structured prototype-setter entries', () => {
    expect(() =>
      parseStructuredTypeEntries(
        "const kinds = { __proto__: { slug: 'entry', slugs: 'entries' } }",
        file,
        'kinds',
        'slug',
        'slugs',
      ),
    ).toThrow(/unsupported __proto__ prototype setter/)
  })

  it('reports missing configured route properties and unsupported union values', () => {
    expect(() =>
      parseUnionRouteConfigEntries(
        "const routes = { alpha: { singular: 'alpha' } }",
        file,
        'routes',
        'kinds',
        'plural',
        'singular',
      ),
    ).toThrow('missing plural')
    expect(() =>
      parseUnionRouteConfigEntries(
        "const routes = { alpha: { plural: 'alphas' } }",
        file,
        'routes',
        'kinds',
        'plural',
        'singular',
      ),
    ).toThrow('missing singular')
    expect(() => parseUnionTypeUnion('type RecordKind = number', file, 'RecordKind')).toThrow(
      'union contains a non-string literal constituent',
    )
  })

  it('recognizes member factory calls and ignores computed callees', () => {
    const source =
      "factories.pageFactory('entry', 'entry'); factories['pageFactory']('entry', 'entry'); (() => 1)('ignored')"
    expect(parseUnionDetailRouteFactoryArgs(source, file, /^pageFactory$/)).toEqual([
      { unionType: 'entry', slug: 'entry' },
      { unionType: 'entry', slug: 'entry' },
    ])
  })

  it('rejects dynamic structured values and ignores computed keys and methods', () => {
    const source =
      "const kinds = { [dynamic]: { slug: 'x', slugs: 'xs' }, alpha: { slug: 'alpha', slugs: 'alphas' } }"
    expect(parseStructuredTypeEntries(source, file, 'kinds', 'slug', 'slugs')).toEqual([
      { value: 'alpha', slug: 'alpha', slugPlural: 'alphas' },
    ])
    expect(() =>
      parseStructuredTypeEntries('const kinds = { ...extra }', file, 'kinds', 'slug', 'slugs'),
    ).toThrow('kinds contains an uninspectable spread')
    expect(() =>
      parseStructuredTypeEntries('const kinds = {}', file, 'kinds', 'slug', 'slugs'),
    ).toThrow('could not parse kinds entries')
    expect(
      parseStructuredTypeEntries(
        "const kinds = { method() {}, alpha: { slug: 'alpha', slugs: 'alphas' } }",
        file,
        'kinds',
        'slug',
        'slugs',
      ),
    ).toHaveLength(1)
    for (const value of ['1', 'buildKind()']) {
      expect(() =>
        parseStructuredTypeEntries(
          `const kinds = { alpha: ${value} }`,
          file,
          'kinds',
          'slug',
          'slugs',
        ),
      ).toThrow('kinds.alpha must be an object literal')
    }
    expect(() =>
      parseStructuredTypeEntries(
        "const kinds = { alpha: { slugs: 'alphas' } }",
        file,
        'kinds',
        'slug',
        'slugs',
      ),
    ).toThrow('missing slug')
    const routes =
      "const kindRoutes = { alpha: { singular: 'alpha', plural: 'alphas', kinds: ['alpha'], special: true } }"
    expect(
      parseStructuredRouteConfigEntries(
        routes,
        file,
        'kindRoutes',
        'kinds',
        'special',
        'plural',
        'singular',
      ),
    ).toMatchObject([{ key: 'alpha', structuredTypes: ['alpha'] }])
    expect(() =>
      parseStructuredRouteConfigEntries(
        'const kindRoutes = { ...extra }',
        file,
        'kindRoutes',
        'kinds',
        'special',
        'plural',
        'singular',
      ),
    ).toThrow('uninspectable route member')
  })

  it('rejects uninspectable configured route type arrays', () => {
    const source =
      "const routes = { entries: { singular: 'entry', plural: 'entries', kinds: ['entry', dynamic] } }"
    expect(() =>
      parseUnionRouteConfigEntries(source, file, 'routes', 'kinds', 'plural', 'singular'),
    ).toThrow('kinds contains a non-string literal element')
    expect(() =>
      parseUnionRouteConfigEntries(
        source.replace("['entry', dynamic]", 'dynamic'),
        file,
        'routes',
        'kinds',
        'plural',
        'singular',
      ),
    ).toThrow('kinds must be a literal string array')
  })

  it('skips unrelated declarations and unmatched structured factory calls', () => {
    const source =
      "type Other = 1; let kinds = {}; const kinds = { alpha: { slug: 'alpha', slugs: 'alphas' } }"
    expect(parseStructuredTypeEntries(source, file, 'kinds', 'slug', 'slugs')).toHaveLength(1)
    expect(
      parseStructuredRouteFactoryArgs(
        "otherFactory('skip'); pageFactory('alpha')",
        file,
        /^pageFactory$/,
      ),
    ).toEqual([{ slug: 'alpha' }])
  })

  it('rejects structured factory calls without configured literal arguments', () => {
    expect(() =>
      parseUnionDetailRouteFactoryArgs(
        "pageFactory('entry'); pageFactory(value, 'entry')",
        file,
        /^pageFactory$/,
      ),
    ).toThrow('configured route factory call needs literal type and slug')
    expect(() =>
      parseStructuredRouteFactoryArgs(
        "otherFactory('skip'); pageFactory(value)",
        file,
        /^pageFactory$/,
      ),
    ).toThrow('configured route factory call needs a string literal slug')
  })

  it('rejects dynamic union factory calls even after a valid call', () => {
    expect(() =>
      parseUnionDetailRouteFactoryArgs(
        "createRecordPage('entry', 'entry'); createRecordPage(dynamicType, dynamicSlug)",
        file,
        /^createRecordPage$/,
      ),
    ).toThrow('configured route factory call needs literal type and slug')
  })

  it('ignores computed structured callees while recognizing a configured factory', () => {
    const source = "(() => 1)('skip'); pageFactory('alpha')"
    expect(parseStructuredRouteFactoryArgs(source, file, /^pageFactory$/)).toEqual([
      { slug: 'alpha' },
    ])
  })
})
