import ts from '@typescript/typescript6'
import { describe, expect, it } from 'vitest'
import { parseUnionRouteConfigEntries, parseStructuredRouteFactoryArgs } from './parsers.mts'
import { checkCollectionPagePathLiterals, checkUnionCreatePageTypes } from './compare.mts'
import { checkFiniteEnumRipple } from './check.mts'
import type { FiniteEnumRippleConfig } from './model.mts'

const file = '/synthetic/routes.ts'

function assertZeroDiagnostics(content: string): void {
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.Latest, skipLibCheck: true }
  const host = ts.createCompilerHost(options)
  const opaque = '/synthetic/opaque.ts'
  const opaqueContent = 'export const value = ["item"]'
  const directoryExists = host.directoryExists!.bind(host)
  host.directoryExists = (path) => path === '/synthetic' || directoryExists(path)
  const fileExists = host.fileExists.bind(host)
  host.fileExists = (path) => path === opaque || fileExists(path)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === file
      ? ts.createSourceFile(file, content, languageVersion, true)
      : path === opaque
        ? ts.createSourceFile(opaque, opaqueContent, languageVersion, true)
        : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([file], options, host)
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
  ).toEqual([])
}

function parse(content: string) {
  assertZeroDiagnostics(content)
  return parseUnionRouteConfigEntries(content, file, 'routes', 'kinds', 'plural', 'singular')
}

const route = "const routes = { all: { singular: 'item', plural: 'items', kinds: undefined } }"

describe('released consumer parity', () => {
  it('accepts explicit intrinsic undefined optional arrays', () => {
    expect(
      parse(`export {}; ${route}`).map(({ key, pluralPath, singularPath, unionTypes }) => ({
        key,
        pluralPath,
        singularPath,
        unionTypes,
      })),
    ).toEqual([{ key: 'all', pluralPath: 'items', singularPath: 'item', unionTypes: [] }])
  })

  it.each([
    `export {}; const undefined = ['item']; ${route}`,
    `import { value as undefined } from './opaque'; ${route}`,
    `export {}; const value = ['item']; ${route.replace('kinds: undefined', 'kinds: value')}`,
    `export {}; ${route.replace('kinds: undefined', 'kinds: null')}`,
  ])('rejects non-intrinsic optional-array expressions: %s', (content) => {
    expect(() => parse(content)).toThrow('kinds must be a literal string array')
  })

  it('preserves missing optional arrays and concrete literal arrays', () => {
    expect(parse(`export {}; ${route.replace(', kinds: undefined', '')}`)[0]!.unionTypes).toEqual(
      [],
    )
    expect(
      parse(`export {}; ${route.replace('kinds: undefined', "kinds: ['item']")}`)[0]!.unionTypes,
    ).toEqual(['item'])
  })

  it('ignores a zero-argument structured factory while retaining selected literal calls', () => {
    const content =
      "declare function createKindPage(slug?: string): unknown; const page = createKindPage(); const stale = createKindPage('wrong')"
    assertZeroDiagnostics(content)
    expect(parseStructuredRouteFactoryArgs(content, file, /^createKindPage$/)).toEqual([
      { slug: 'wrong' },
    ])
  })

  it('accepts a create page without local type fields and still rejects stale literal fields', () => {
    const pages = [{ file, slug: 'items', isTopLevel: true }]
    const routes = [{ pluralPath: 'items', unionTypes: ['item'] }]
    const errors: string[] = []
    const absent = 'export const render = () => null'
    assertZeroDiagnostics(absent)
    checkUnionCreatePageTypes(errors, routes, pages, () => absent, ['action', 'itemType'], 'item')
    expect(errors).toEqual([])
    const stale = "export const form = { action: 'other' }"
    assertZeroDiagnostics(stale)
    checkUnionCreatePageTypes(errors, routes, pages, () => stale, ['action', 'itemType'], 'item')
    expect(errors).toEqual([
      `::error file=${file}::${file}: item create page literal uses "other" but items expects "item".`,
    ])
  })

  it('ignores empty collection paths and still rejects stale concrete paths', () => {
    const pages = [{ file, slug: 'items', isTopLevel: true }]
    const errors: string[] = []
    const read = () => "export const page = { path: '/' }; export const stale = { path: '/other' }"
    assertZeroDiagnostics(read())
    checkCollectionPagePathLiterals(
      pages,
      errors,
      'items',
      new Set(['items']),
      read,
      /path:\s*['"]\/([^'"]*)['"]/g,
    )
    expect(errors).toEqual([
      `::error file=${file}::${file}: items collection path literal "/other" does not match route directory "items".`,
    ])
  })

  it('configures collection path wording independently from enum comparison labels', () => {
    const contents = new Map([
      ['src/types.ts', "export type Kind = 'item'"],
      [
        file,
        "export const slugs = { item: 'item' }; export const routes = { items: { singular: 'item', plural: 'items', kinds: ['item'] } }",
      ],
      ['ui/item/page.ts', "export const page = createPage('item', 'item')"],
      ['ui/items/page.ts', "export const page = { path: '/other' }"],
    ])
    const config: FiniteEnumRippleConfig = {
      files: {
        existingFileSet: new Set(contents.keys()),
        unionCollectionPages: [{ file: 'ui/items/page.ts', slug: 'items', isTopLevel: true }],
        unionDetailPages: [{ file: 'ui/item/page.ts', slug: 'item', isTopLevel: true }],
        unionCreatePages: [],
        structuredCollectionPages: [],
        structuredComponentFiles: [],
        structuredDetailPages: [],
      },
      union: {
        typesPath: 'src/types.ts',
        routeConfigsPath: file,
        typeAlias: 'Kind',
        slugMapObject: 'slugs',
        routeConfigObject: 'routes',
        typeArrayProperty: 'kinds',
        pluralPathProperty: 'plural',
        singularPathProperty: 'singular',
        factoryCallPattern: /^createPage$/,
        internalTypes: [],
        routeConfigExceptions: [],
        routeLabels: {
          detailTop: 'details',
          detail: 'details',
          collectionTop: 'collections',
          collection: 'collections',
          factory: 'factories',
        },
        collectionLabel: 'public item',
        collectionPathLabel: 'items',
        createPageTypeProperties: [],
        collectionPathLiteralPattern: /path:\s*['"]\/([^'"]*)['"]/g,
      },
    }
    const errors = checkFiniteEnumRipple(
      {
        repoRoot: '/synthetic',
        isInsideGitRepo: true,
        trackedFiles: [...contents.keys()],
        trackedFileSet: config.files.existingFileSet,
        readTrackedFile: (path) => contents.get(path) ?? null,
      },
      config,
    )
    expect(errors).toEqual([
      '::error file=ui/items/page.ts::ui/items/page.ts: items collection path literal "/other" does not match route directory "items".',
    ])
  })
})
