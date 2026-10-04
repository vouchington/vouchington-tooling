import { describe, expect, it } from 'vitest'
import {
  parsePostDetailRouteFactoryArgs,
  parsePostRouteConfigEntries,
  parsePostSlugToType,
  parsePostTypeUnion,
  parseTopicRouteConfigEntries,
  parseTopicRouteFactoryArgs,
  parseTopicTypeEntries,
} from './parsers.mts'

const file = 'src/catalog.ts'

describe('finite enum parsers', () => {
  it('parses compact and multiline objects without comment coupling', () => {
    const source = [
      "export const kinds = { alpha: { slug: 'alpha', slugs: 'alphas' },",
      "  /* beta: { slug: 'beta', slugs: 'betas' }, */",
      "  gamma: { slug: 'gamma', slugs: 'gammas' } } as const",
    ].join('\n')
    expect(parseTopicTypeEntries(source, file, 'kinds', 'slug', 'slugs')).toEqual([
      { value: 'alpha', slug: 'alpha', slugPlural: 'alphas' },
      { value: 'gamma', slug: 'gamma', slugPlural: 'gammas' },
    ])
  })

  it('reports missing properties and malformed declarations', () => {
    expect(() =>
      parseTopicTypeEntries(
        "const kinds = { alpha: { slug: 'alpha' } }",
        file,
        'kinds',
        'slug',
        'slugs',
      ),
    ).toThrow(`${file}: kinds.alpha is missing slugs`)
    expect(() =>
      parseTopicTypeEntries(
        "const kinds = { alpha: { slug: 'alpha'",
        file,
        'kinds',
        'slug',
        'slugs',
      ),
    ).toThrow(`${file}: could not find end of kinds`)
    expect(() => parsePostTypeUnion('type Other = 1', file, 'RecordKind')).toThrow(
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
      parseTopicRouteConfigEntries(
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
        topicTypes: ['alpha'],
        spendingCategory: true,
      },
    ])
    expect(
      parsePostRouteConfigEntries(source, file, 'recordRoutes', 'kinds', 'plural', 'singular'),
    ).toMatchObject([
      { key: 'entries', singularPath: 'entry', pluralPath: 'entries', postTypes: ['entry'] },
    ])
    expect([...parsePostSlugToType(source, file, 'recordSlugs')]).toEqual([['entry', 'entry']])
    expect(parsePostTypeUnion(source, file, 'RecordKind')).toEqual(['entry', 'internal'])
  })

  it('accepts imported factory aliases and ignores unrelated calls', () => {
    const source = [
      "import { createRecordPage as pageFactory } from './factories'",
      "const Page = pageFactory('entry', 'entry')",
      "otherFactory('skip', 'skip')",
    ].join('\n')
    expect(parsePostDetailRouteFactoryArgs(source, file, /^pageFactory$/)).toEqual([
      { postType: 'entry', slug: 'entry' },
    ])
    expect(
      parseTopicRouteFactoryArgs("const Page = pageFactory('alpha')", file, /^pageFactory$/),
    ).toEqual([{ slug: 'alpha' }])
  })

  it('rejects missing or non-object declarations with configured names', () => {
    expect(() => parseTopicTypeEntries('const other = {}', file, 'kinds', 'slug', 'slugs')).toThrow(
      'could not find kinds',
    )
    expect(() => parseTopicTypeEntries('const kinds = 1', file, 'kinds', 'slug', 'slugs')).toThrow(
      'could not find kinds',
    )
  })

  it('ignores non-string values and unsupported object members', () => {
    const source =
      "const recordSlugs = { 'entry': 'entry', 7: 'number', [dynamic]: 'ignored', other: false, ...extra }"
    expect([...parsePostSlugToType(source, file, 'recordSlugs')]).toEqual([
      ['entry', 'entry'],
      ['7', 'number'],
    ])
    expect(() =>
      parsePostSlugToType('const recordSlugs = { other: false }', file, 'recordSlugs'),
    ).toThrow('could not parse recordSlugs entries')
  })

  it('reports missing configured route properties and unsupported union values', () => {
    expect(() =>
      parsePostRouteConfigEntries(
        "const routes = { alpha: { singular: 'alpha' } }",
        file,
        'routes',
        'kinds',
        'plural',
        'singular',
      ),
    ).toThrow('missing plural')
    expect(() =>
      parsePostRouteConfigEntries(
        "const routes = { alpha: { plural: 'alphas' } }",
        file,
        'routes',
        'kinds',
        'plural',
        'singular',
      ),
    ).toThrow('missing singular')
    expect(() => parsePostTypeUnion('type RecordKind = number', file, 'RecordKind')).toThrow(
      'union has no values',
    )
  })

  it('recognizes member factory calls and ignores computed callees', () => {
    const source = "factories.pageFactory('entry', 'entry'); (() => 1)('ignored')"
    expect(parsePostDetailRouteFactoryArgs(source, file, /^pageFactory$/)).toEqual([
      { postType: 'entry', slug: 'entry' },
    ])
  })

  it('skips unsupported members and rejects empty configured objects', () => {
    const source =
      "const kinds = { ...extra, [dynamic]: { slug: 'x', slugs: 'xs' }, scalar: 1, alpha: { ...extra, slug: 'alpha', slugs: 'alphas' } }"
    expect(parseTopicTypeEntries(source, file, 'kinds', 'slug', 'slugs')).toEqual([
      { value: 'alpha', slug: 'alpha', slugPlural: 'alphas' },
    ])
    expect(() =>
      parseTopicTypeEntries('const kinds = { ...extra }', file, 'kinds', 'slug', 'slugs'),
    ).toThrow('could not parse kinds entries')
    expect(() =>
      parseTopicTypeEntries(
        "const kinds = { alpha: { slugs: 'alphas' } }",
        file,
        'kinds',
        'slug',
        'slugs',
      ),
    ).toThrow('missing slug')
    const routes =
      "const kindRoutes = { ...extra, [dynamic]: {}, scalar: 1, alpha: { ...extra, singular: 'alpha', plural: 'alphas', kinds: [false, 'alpha'], special: true } }"
    expect(
      parseTopicRouteConfigEntries(
        routes,
        file,
        'kindRoutes',
        'kinds',
        'special',
        'plural',
        'singular',
      ),
    ).toMatchObject([{ key: 'alpha', topicTypes: ['alpha'] }])
    expect(() =>
      parseTopicRouteConfigEntries(
        'const kindRoutes = { ...extra }',
        file,
        'kindRoutes',
        'kinds',
        'special',
        'plural',
        'singular',
      ),
    ).toThrow('could not parse kindRoutes entries')
  })

  it('skips unrelated declarations and unmatched topic factory calls', () => {
    const source =
      "type Other = 1; let kinds = {}; const kinds = { alpha: { ...extra, slug: 'alpha', slugs: 'alphas' } }"
    expect(parseTopicTypeEntries(source, file, 'kinds', 'slug', 'slugs')).toHaveLength(1)
    expect(
      parseTopicRouteFactoryArgs(
        "otherFactory('skip'); pageFactory('alpha')",
        file,
        /^pageFactory$/,
      ),
    ).toEqual([{ slug: 'alpha' }])
  })
})
