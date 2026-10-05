import { expect, it } from 'vitest'
import ts from '@typescript/typescript6'
import {
  parseStructuredTypeEntries,
  parseUnionDetailRouteFactoryArgs,
  parseUnionRouteConfigEntries,
  parseUnionTypeUnion,
} from './parsers.mts'
import { collectActivePatternCaptures } from './pattern-captures.mts'
import { collectCreatePageLiterals } from './create-page-literals.mts'
import { checkUnionCreatePageTypes } from './compare.mts'
import { getStringProperty } from './parser-support.mts'
import { hasConfiguredObjectDeclaration } from './ast.mts'
import { checkFiniteEnumRipple } from './check.mts'
import { checkUnionTypes } from './union-types.mts'
import { checkStructuredRouteConfigs } from './structured-route-check.mts'
import type { FiniteEnumFiles, FiniteEnumRippleConfig } from './model.mts'

const file = 'fixture/routes.ts'

it('reads a named property safely from a standalone object with other member forms', () => {
  const source = ts.createSourceFile(
    file,
    "const value = { ...base, slug: 'entry' }",
    ts.ScriptTarget.Latest,
    true,
  )
  const declaration = source.statements[0] as ts.VariableStatement
  const object = declaration.declarationList.declarations[0]!
    .initializer as ts.ObjectLiteralExpression
  expect(getStringProperty(object, 'slug')).toBe('entry')
})

it('keeps executable backtick route literals while ignoring embedded examples', () => {
  const source = 'const example = "path: `/old`"; const route = { path: `/right` }'
  expect(collectActivePatternCaptures(source, /[`]\/([^`]*)[`]/g, file)).toEqual(['right'])
})

it('rescans interpolated template tails before later active route literals', () => {
  const source =
    "const note = `prefix ${({ key: value }).key} suffix`; const route = { path: '/wrong' }"
  expect(collectActivePatternCaptures(source, /path:\s*'\/([^']+)'/g, file)).toEqual(['wrong'])
  const nested =
    "const note = `prefix ${`nested ${value}`} suffix`; const route = { path: '/right' }"
  expect(collectActivePatternCaptures(nested, /path:\s*'\/([^']+)'/g, file)).toEqual(['right'])
  const multiple =
    "const note = `prefix ${value} middle ${other} suffix`; const route = { path: '/again' }"
  expect(collectActivePatternCaptures(multiple, /path:\s*'\/([^']+)'/g, file)).toEqual(['again'])
})

it('maps diagnostics to the longest matching configured path', () => {
  const backendPath = 'catalog.ts'
  const webPath = 'catalog.ts:pages/detail.tsx'
  const contents = new Map([
    [backendPath, "const kinds = { alpha: { slug: 'alpha', slugs: 'alphas' } }"],
    [webPath, 'const kinds = { alpha: buildKind() }'],
  ])
  const files: FiniteEnumFiles = {
    existingFileSet: new Set(contents.keys()),
    unionCollectionPages: [],
    unionCreatePages: [],
    unionDetailPages: [],
    structuredCollectionPages: [],
    structuredComponentFiles: [],
    structuredDetailPages: [],
  }
  const context = {
    repoRoot: '/synthetic',
    isInsideGitRepo: true,
    trackedFiles: [...contents.keys()],
    trackedFileSet: files.existingFileSet,
    readTrackedFile: (file: string) => contents.get(file) ?? null,
  }
  const config: FiniteEnumRippleConfig = {
    files,
    structured: {
      backendPath,
      webPath,
      routeConfigsPath: 'routes.ts',
      typeObject: 'kinds',
      routeConfigObject: 'routes',
      typeArrayProperty: 'kinds',
      pluralPathProperty: 'plural',
      singularPathProperty: 'singular',
      routeExemptionProperty: 'special',
      slugProperty: 'slug',
      slugPluralProperty: 'slugs',
      factoryCallPattern: /^factory$/,
      routeConfigExceptions: [],
      collectionRouteExclusions: [],
      routeLabels: {
        detailTop: 'top',
        detail: 'detail',
        collectionTop: 'top',
        collection: 'collection',
      },
      collectionLabel: 'kind',
      ignoredNavigationPaths: [],
      collectionPathLiteralPattern: /path:\s*'\/([^']*)'/,
      navigationPathLiteralPattern: /push\('\/([^']*)'/,
    },
  }
  const errors = checkFiniteEnumRipple(context, config)
  expect(errors).toContainEqual(
    expect.stringContaining('::error file=catalog.ts%3Apages/detail.tsx::'),
  )
})

it('keeps route matches active after JSX apostrophes and regex quotes', () => {
  expect(
    collectActivePatternCaptures(
      "const view = <p>It's here</p> {push('/stale')}",
      /push\('\/([^']+)'\)/g,
      'page.tsx',
    ),
  ).toEqual(['stale'])
  expect(
    collectActivePatternCaptures(
      "const matcher = /'/; push('/stale')",
      /push\('\/([^']+)'\)/g,
      'page.ts',
    ),
  ).toEqual(['stale'])
  expect(
    collectActivePatternCaptures(
      "const identity = <T>(value: T) => value; push('/later')",
      /push\('\/([^']+)'\)/g,
      'page.ts',
    ),
  ).toEqual(['later'])
})

it('accepts an empty string constituent in a finite union', () => {
  expect(parseUnionTypeUnion("type Kind = '' | 'entry'", file, 'Kind')).toEqual(['', 'entry'])
  expect(parseUnionDetailRouteFactoryArgs("createPage('', 'root')", file, /^createPage$/)).toEqual([
    { unionType: '', slug: 'root' },
  ])
})

it('uses inferred exception routes for create-page and collection-path checks', () => {
  const contents = new Map([
    ['types.ts', "type Kind = '' | 'entry'"],
    [
      'routes.ts',
      "const slugs = { root: '', entry: 'entry' }; const routes = { roots: { singular: 'root', plural: 'roots', kinds: [''] }, entries: { singular: 'entry', plural: 'entries' } }",
    ],
    ['create.tsx', "const fields = { action: 'entry' }"],
    ['collection.tsx', "const route = { path: '/wrong' }"],
    ['collection-root.tsx', "const route = { path: '/roots' }"],
  ])
  const files: FiniteEnumFiles = {
    existingFileSet: new Set(contents.keys()),
    unionCollectionPages: [
      { file: 'collection.tsx', slug: 'entries', isTopLevel: true },
      { file: 'collection-root.tsx', slug: 'roots', isTopLevel: true },
    ],
    unionCreatePages: [{ file: 'create.tsx', slug: 'entries', isTopLevel: true }],
    unionDetailPages: [],
    structuredCollectionPages: [],
    structuredComponentFiles: [],
    structuredDetailPages: [],
  }
  const config: NonNullable<FiniteEnumRippleConfig['union']> = {
    typesPath: 'types.ts',
    routeConfigsPath: 'routes.ts',
    typeAlias: 'Kind',
    slugMapObject: 'slugs',
    routeConfigObject: 'routes',
    typeArrayProperty: 'kinds',
    pluralPathProperty: 'plural',
    singularPathProperty: 'singular',
    factoryCallPattern: /^createPage$/,
    internalTypes: [],
    routeConfigExceptions: ['entries'],
    routeLabels: {
      detailTop: 'top',
      detail: 'detail',
      collectionTop: 'top collection',
      collection: 'collection',
      factory: 'factory',
    },
    collectionLabel: 'kind',
    createPageTypeProperties: ['action'],
    collectionPathLiteralPattern: /path:\s*'\/([^']+)'/g,
  }
  const errors: string[] = []
  checkUnionTypes(errors, files, (path) => contents.get(path)!, config)
  expect(errors.join('\n')).not.toContain('maps singular')
  expect(errors.join('\n')).not.toContain('route config singular paths mismatch')
  expect(errors.join('\n')).not.toContain('no matching single-type route config')
  expect(errors.join('\n')).toContain(
    'collection path literal "/wrong" does not match route directory "entries"',
  )
})

it('counts an inferred exempt structured route as a present declaration value', () => {
  const routeContent =
    "const routes = { roots: { singular: 'root', plural: 'roots', special: true } }"
  const files: FiniteEnumFiles = {
    existingFileSet: new Set(['routes.ts', 'page.ts']),
    structuredDetailPages: [],
    structuredCollectionPages: [{ file: 'page.ts', slug: 'roots', isTopLevel: true }],
    structuredComponentFiles: [],
    unionDetailPages: [],
    unionCollectionPages: [],
    unionCreatePages: [],
  }
  const config: NonNullable<FiniteEnumRippleConfig['structured']> = {
    backendPath: 'types.ts',
    webPath: 'web.ts',
    routeConfigsPath: 'routes.ts',
    typeObject: 'kinds',
    routeConfigObject: 'routes',
    typeArrayProperty: 'kinds',
    pluralPathProperty: 'plural',
    singularPathProperty: 'singular',
    routeExemptionProperty: 'special',
    slugProperty: 'slug',
    slugPluralProperty: 'slugs',
    factoryCallPattern: /^factory$/,
    routeConfigExceptions: [],
    collectionRouteExclusions: [],
    routeLabels: {
      detailTop: 'top',
      detail: 'detail',
      collectionTop: 'top collection',
      collection: 'collection',
    },
    collectionLabel: 'kind',
    ignoredNavigationPaths: [],
    collectionPathLiteralPattern: /path:\s*'\/([^']+)'/g,
    navigationPathLiteralPattern: /push\('\/([^']+)'\)/g,
  }
  const errors: string[] = []
  checkStructuredRouteConfigs(
    errors,
    files,
    (path) => (path === 'routes.ts' ? routeContent : "const page = { path: '/roots' }"),
    config,
    [{ value: 'alpha', slug: 'root', slugPlural: 'roots' }],
    new Map([['alpha', 'root']]),
  )
  expect(errors).toEqual([])
})

it('rejects overriding members inside structured slug bodies', () => {
  const parse = (body: string) =>
    parseStructuredTypeEntries(`const kinds = { alpha: ${body} }`, file, 'kinds', 'slug', 'slugs')
  expect(() => parse("{ slug: 'alpha', slugs: 'alphas', ...overrides }")).toThrow(
    'contains an uninspectable member',
  )
  expect(() => parse("{ slug: 'alpha', slugs: 'alphas', slug: 'other' }")).toThrow(
    'uninspectable or duplicate key',
  )
  expect(() => parse("{ slug: 'alpha', slugs: 'alphas', [dynamic]: 'other' }")).toThrow(
    'uninspectable or duplicate key',
  )
})

it('preserves an empty structured key and detects mutable configured declarations', () => {
  expect(
    parseStructuredTypeEntries(
      "const kinds = { '': { slug: 'root', slugs: 'roots' } }",
      file,
      'kinds',
      'slug',
      'slugs',
    ),
  ).toEqual([{ value: '', slug: 'root', slugPlural: 'roots' }])
  expect(hasConfiguredObjectDeclaration('let routes = {}', 'routes', file)).toBe(true)
  expect(() =>
    parseUnionRouteConfigEntries('let routes = {}', file, 'routes', 'kinds', 'plural', 'singular'),
  ).toThrow('could not find routes')
  expect(hasConfiguredObjectDeclaration('const other = {}', 'routes', file)).toBe(false)
})

it('rejects route members that cannot be fully inspected', () => {
  const parse = (source: string) =>
    parseUnionRouteConfigEntries(source, file, 'routes', 'kinds', 'plural', 'singular')
  const valid = "entries: { kinds: ['entry'], plural: 'entries', singular: 'entry' }"
  expect(() => parse(`const routes = { ${valid}, ...extra }`)).toThrow('uninspectable route member')
  expect(() => parse(`const routes = { ${valid}, shorthand }`)).toThrow(
    'uninspectable route member',
  )
  expect(() => parse(`const routes = { ${valid}, [dynamic]: {} }`)).toThrow(
    'uninspectable route key',
  )
  expect(() => parse(`const routes = { ${valid}, other: createRoute() }`)).toThrow(
    'must be an object literal',
  )
  expect(() => parse('const routes = {}')).toThrow('could not parse routes entries')
  expect(() =>
    parse(
      "const routes = { entries: { singular: 'entry', plural: 'entries', kinds: ['entry'], ...overrides } }",
    ),
  ).toThrow('contains an uninspectable member')
  expect(() =>
    parse(
      "const routes = { entries: { singular: 'entry', plural: 'entries', kinds: ['entry'], [dynamic]: 'value' } }",
    ),
  ).toThrow('uninspectable or duplicate key')
  expect(() =>
    parse(
      "const routes = { entries: { singular: 'entry', singular: 'other', plural: 'entries', kinds: ['entry'] } }",
    ),
  ).toThrow('uninspectable or duplicate key')
})

it('collects literal element-access assignments but not dynamic property names', () => {
  expect(
    collectCreatePageLiterals(
      "form['action'] = 'other'; form[key] = 'ignored'; ({ other } = 'skip')",
      'page.tsx',
      ['action'],
    ),
  ).toEqual(['other'])
  expect(collectCreatePageLiterals("(form.action) = 'other'", 'page.tsx', ['action'])).toEqual([
    'other',
  ])
})

it('reports a selected create page without a matching single-type route', () => {
  const errors: string[] = []
  checkUnionCreatePageTypes(
    errors,
    [{ pluralPath: 'entries', unionTypes: ['entry'] }],
    [{ file: 'page.tsx', slug: 'drafts', isTopLevel: true }],
    () => "form['action'] = 'entry'",
    ['action'],
    'record',
  )
  expect(errors.join('\n')).toContain('no matching single-type route config for "drafts"')
})

it('rejects selected create pages with no literal or with dynamic configured values', () => {
  const errors: string[] = []
  const routes = [{ pluralPath: 'entries', unionTypes: ['entry'] }]
  const pages = [{ file: 'page.tsx', slug: 'entries', isTopLevel: true }]
  checkUnionCreatePageTypes(
    errors,
    routes,
    pages,
    () => 'const fields = { other: 1 }',
    ['action'],
    'record',
  )
  expect(errors.join('\n')).toContain('no inspectable type literal')
  for (const source of [
    'const fields = { action: selectedType }',
    "const action = choose(); const fields = { action, other: 'entry' }",
    'const view = <Form action={selectedType} />',
    'form.action = selectedType',
  ]) {
    expect(() => collectCreatePageLiterals(source, 'page.tsx', ['action'])).toThrow(
      'create page action must be a string literal',
    )
  }
  expect(() =>
    collectCreatePageLiterals("const fields = { action: 'entry', [selected]: other }", 'page.tsx', [
      'action',
    ]),
  ).toThrow('overridden by a trailing computed property')
})

it('rejects object and JSX spreads after a configured create-page type', () => {
  expect(() =>
    collectCreatePageLiterals("const fields = { action: 'entry', ...dynamicProps }", 'page.ts', [
      'action',
    ]),
  ).toThrow('overridden by a trailing spread')
  expect(
    collectCreatePageLiterals(
      "const fields = { action: 'entry', ...{ label: 'new' } }",
      'page.ts',
      ['action'],
    ),
  ).toEqual(['entry'])
  expect(
    collectCreatePageLiterals(
      "const view = <Form action='entry' {...{ label: 'new' }} />",
      'page.tsx',
      ['action'],
    ),
  ).toEqual(['entry'])
  for (const spread of ["{ action: 'wrong' }", '{ [selected]: value }', '{ ...defaults }']) {
    expect(() =>
      collectCreatePageLiterals(`const fields = { action: 'entry', ...${spread} }`, 'page.ts', [
        'action',
      ]),
    ).toThrow('overridden by a trailing spread')
  }
  expect(
    collectCreatePageLiterals(
      "const fields = { action: 'entry', ...{ ['label']: 'new' } }",
      'page.ts',
      ['action'],
    ),
  ).toEqual(['entry'])
  expect(() =>
    collectCreatePageLiterals(
      "const fields = { action: 'entry', ...{ ['action']: 'wrong' } }",
      'page.ts',
      ['action'],
    ),
  ).toThrow('overridden by a trailing spread')
  expect(() =>
    collectCreatePageLiterals(
      "const view = <Form action='entry' {...dynamicProps} />",
      'page.tsx',
      ['action'],
    ),
  ).toThrow('overridden by a trailing spread')
  expect(
    collectCreatePageLiterals("const fields = { ...defaults, action: 'entry' }", 'page.ts', [
      'action',
    ]),
  ).toEqual(['entry'])
  expect(
    collectCreatePageLiterals("const view = <Form {...defaults} action='entry' />", 'page.tsx', [
      'action',
    ]),
  ).toEqual(['entry'])
  for (const spread of ["({ action: 'wrong' })", "({ action: 'wrong' } as const)"]) {
    expect(
      collectCreatePageLiterals(`const fields = { ...${spread}, action: 'entry' }`, 'page.ts', [
        'action',
      ]),
    ).toEqual(['entry'])
  }
  expect(
    collectCreatePageLiterals(
      "const fields = { ...{ nested: { action: 'wrong' } }, action: 'entry' }",
      'page.ts',
      ['action'],
    ),
  ).toEqual(['wrong', 'entry'])
  expect(
    collectCreatePageLiterals(
      "const fields = { ...{ label: 'first' }, label: 'second', action: 'entry' }",
      'page.ts',
      ['action'],
    ),
  ).toEqual(['entry'])
})

it('preserves the legacy exclusion for configured create-page methods and accessors', () => {
  expect(
    collectCreatePageLiterals(
      "const fields = { action() { return 'entry' }, get type() { return 'entry' } }",
      'page.ts',
      ['action', 'type'],
    ),
  ).toEqual([])
})

it('retains empty create-page values in objects, JSX, and assignments', () => {
  expect(
    collectCreatePageLiterals(
      "const fields = { action: '' }; action = ''; form.action = ''",
      'page.ts',
      ['action'],
    ),
  ).toEqual(['', '', ''])
  expect(
    collectCreatePageLiterals(
      "const fields = { ['action']: 'wrong', unionType: 'entry' }",
      'page.ts',
      ['action', 'unionType'],
    ),
  ).toEqual(['wrong', 'entry'])
  expect(
    collectCreatePageLiterals("const view = <Form action='' type={''} />", 'page.tsx', [
      'action',
      'type',
    ]),
  ).toEqual(['', ''])
})

it('parses non-JSX create pages as TypeScript after angle-bracket assertions', () => {
  const source = "const cast = <string>input; const fields = { action: 'wrong' }"
  expect(collectCreatePageLiterals(source, 'page.mts', ['action'])).toEqual(['wrong'])
})
