import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SharedContext } from '../shared-context/index.mts'
import {
  checkFiniteEnumRipple,
  type FiniteEnumFiles,
  type FiniteEnumRippleConfig,
} from './index.mts'

const paths = {
  source: 'src/kinds.ts',
  client: 'ui/kinds.ts',
  routes: 'ui/routes.ts',
  union: 'src/records.ts',
  detail: 'ui/alpha/[id]/page.tsx',
  collection: 'ui/alphas/page.tsx',
  component: 'ui/alphas/nav.tsx',
  recordDetail: 'ui/entry/[id]/page.tsx',
  recordCollection: 'ui/entries/page.tsx',
  recordCreate: 'ui/entries/create/page.tsx',
} as const

function fixture() {
  const contents = new Map<string, string>([
    [paths.source, "export const kinds = { alpha: { slug: 'alpha', slugs: 'alphas' } } as const"],
    [paths.client, "export const kinds = { alpha: { slug: 'alpha', slugs: 'alphas' } } as const"],
    [paths.union, "export type RecordKind = 'entry' | 'internal'"],
    [
      paths.routes,
      [
        "export const recordSlugs = { entry: 'entry' } as const",
        "export const recordRoutes = { entries: { singular: 'entry', plural: 'entries', kinds: ['entry'] } }",
        "export const kindRoutes = { alphas: { singular: 'alpha', plural: 'alphas', kinds: ['alpha'] } }",
      ].join('\n'),
    ],
    [paths.detail, "const Page = createKindPage('alpha')"],
    [paths.collection, "export default { path: '/alphas' }"],
    [paths.component, "push('/alphas')"],
    [paths.recordDetail, "const Page = createRecordPage('entry', 'entry')"],
    [paths.recordCollection, "export default { path: '/entries' }"],
    [paths.recordCreate, "const form = { action: 'entry', unionType: 'entry' }"],
  ])
  const pages = (file: string, slug: string) => [{ file, slug, isTopLevel: true }]
  const files: FiniteEnumFiles = {
    existingFileSet: new Set(contents.keys()),
    structuredDetailPages: pages(paths.detail, 'alpha'),
    structuredCollectionPages: pages(paths.collection, 'alphas'),
    structuredComponentFiles: [{ file: paths.component, slug: 'alphas' }],
    unionDetailPages: pages(paths.recordDetail, 'entry'),
    unionCollectionPages: pages(paths.recordCollection, 'entries'),
    unionCreatePages: pages(paths.recordCreate, 'entries'),
  }
  const ctx: SharedContext = {
    repoRoot: '/synthetic',
    isInsideGitRepo: true,
    trackedFiles: [...contents.keys()],
    trackedFileSet: files.existingFileSet,
    readTrackedFile: (file) => contents.get(file) ?? null,
  }
  const config: FiniteEnumRippleConfig = {
    files,
    structured: {
      backendPath: paths.source,
      webPath: paths.client,
      routeConfigsPath: paths.routes,
      typeObject: 'kinds',
      routeConfigObject: 'kindRoutes',
      typeArrayProperty: 'kinds',
      routeExemptionProperty: 'special',
      slugProperty: 'slug',
      slugPluralProperty: 'slugs',
      pluralPathProperty: 'plural',
      singularPathProperty: 'singular',
      factoryCallPattern: /^createKindPage$/,
      routeConfigExceptions: [],
      collectionRouteExclusions: [],
      ignoredNavigationPaths: [],
      collectionPathLiteralPattern: /\bpath:\s*['"]\/([^'"]*)['"]/g,
      navigationPathLiteralPattern: /\b(?:push|replace|redirect)\(\s*['"`]\/([^'"`$)}]+)/g,
      collectionLabel: 'kind',
      routeLabels: {
        detailTop: 'top kind pages',
        detail: 'kind pages',
        collectionTop: 'top kind collections',
        collection: 'kind collections',
      },
    },
    union: {
      typesPath: paths.union,
      routeConfigsPath: paths.routes,
      typeAlias: 'RecordKind',
      slugMapObject: 'recordSlugs',
      routeConfigObject: 'recordRoutes',
      typeArrayProperty: 'kinds',
      pluralPathProperty: 'plural',
      singularPathProperty: 'singular',
      factoryCallPattern: /^createRecordPage$/,
      internalTypes: ['internal'],
      routeConfigExceptions: [],
      collectionLabel: 'record',
      createPageTypeProperties: ['action', 'unionType'],
      collectionPathLiteralPattern: /\bpath:\s*['"]\/([^'"]*)['"]/g,
      routeLabels: {
        detailTop: 'top record pages',
        detail: 'record pages',
        collectionTop: 'top record collections',
        collection: 'record collections',
        factory: 'record factories',
      },
    },
  }
  return { contents, files, ctx, config, check: () => checkFiniteEnumRipple(ctx, config) }
}

describe('checkFiniteEnumRipple', () => {
  it('accepts compact declarations and catches a missing collection route for a new value', () => {
    const { contents, config, check } = fixture()
    expect(check()).toEqual([])
    const expanded =
      "export const kinds = { alpha: { slug: 'alpha', slugs: 'alphas' }, beta: { slug: 'beta', slugs: 'betas' } }"
    contents.set(paths.source, expanded)
    contents.set(paths.client, expanded)
    expect(check()).toContainEqual(expect.stringContaining('kind route config values mismatch'))
    config.structured!.collectionRouteExclusions = ['beta']
    expect(check()).not.toContainEqual(expect.stringContaining('kind route config values mismatch'))
  })

  it('reports structured slug disagreement and ignores commented entries', () => {
    const { contents, check } = fixture()
    contents.set(
      paths.client,
      "export const kinds = { alpha: { slug: 'alpha', slugs: 'different' }, /* beta: { slug: 'beta', slugs: 'betas' } */ } as const",
    )
    expect(check()).toEqual([expect.stringContaining('kinds.alpha.slugs is "different"')])
  })

  it('checks top-level and nested routed pages separately', () => {
    const { files, check } = fixture()
    files.structuredDetailPages = [{ file: paths.detail, slug: 'alpha', isTopLevel: false }]
    expect(check()).toContainEqual(expect.stringContaining('kind route directories mismatch'))
    expect(check()).not.toContainEqual(expect.stringContaining('kind routed pages mismatch'))
  })

  it('checks route config and factory mismatches', () => {
    const { contents, check } = fixture()
    contents.set(
      paths.routes,
      contents.get(paths.routes)!.replace("singular: 'alpha'", "singular: 'wrong'"),
    )
    contents.set(paths.detail, "const Page = factories['createKindPage']('wrong')")
    expect(check()).toContainEqual(expect.stringContaining('kind route factory slug mismatch'))
    expect(check()).toContainEqual(expect.stringContaining('kindRoutes.alphas maps'))
  })

  it('checks record union, slug map, create page and detail factory', () => {
    const { contents, check } = fixture()
    contents.set(paths.union, "export type RecordKind = 'entry' | 'other' | 'internal'")
    contents.set(paths.recordCreate, "const form = { action: 'other' }")
    contents.set(paths.recordDetail, "const Page = createRecordPage('other', 'entry')")
    expect(check()).toContainEqual(expect.stringContaining('record route config values mismatch'))
    expect(check()).toContainEqual(
      expect.stringContaining('record create page literal uses "other"'),
    )
    expect(check()).toContainEqual(expect.stringContaining('record route factory args mismatch'))
  })

  it('skips a family when its required declaration is absent', () => {
    const { files, check } = fixture()
    files.existingFileSet = new Set(
      [...files.existingFileSet].filter((file) => file !== paths.source),
    )
    expect(check()).toEqual([])
  })

  it('rejects malformed configured declarations', () => {
    const { contents, check } = fixture()
    contents.set(paths.source, "export const kinds = { alpha: { slug: 'alpha'")
    expect(check()).toContainEqual(
      expect.stringContaining(
        `::error file=${paths.source}::${paths.source}: could not find end of kinds`,
      ),
    )
  })

  it('reports configured collection literals, component paths and duplicate values', () => {
    const { contents, check } = fixture()
    contents.set(paths.collection, "export default { path: '/wrong' }")
    contents.set(paths.component, "push('/wrong')")
    contents.set(
      paths.routes,
      contents.get(paths.routes)!.replace("kinds: ['alpha']", "kinds: ['alpha', 'alpha']"),
    )
    expect(check()).toContainEqual(expect.stringContaining('kind collection path literal'))
    expect(check()).toContainEqual(expect.stringContaining('kind component navigation path'))
    expect(check()).toContainEqual(expect.stringContaining('duplicate in actual values: alpha'))
  })

  it('reports missing configured type arrays and mismatched route keys', () => {
    const { contents, check } = fixture()
    contents.set(
      paths.routes,
      contents
        .get(paths.routes)!
        .replace(
          "alphas: { singular: 'alpha', plural: 'alphas', kinds: ['alpha'] }",
          "wrong: { singular: 'alpha', plural: 'alphas' }",
        )
        .replace(
          "entries: { singular: 'entry', plural: 'entries', kinds: ['entry'] }",
          "wrong: { singular: 'entry', plural: 'entries' }",
        ),
    )
    expect(check()).toContainEqual(expect.stringContaining('kindRoutes.wrong has singular'))
    expect(check()).toContainEqual(expect.stringContaining('kindRoutes.wrong has plural'))
    expect(check()).toContainEqual(expect.stringContaining('recordRoutes.wrong has singular'))
    expect(check()).toContainEqual(expect.stringContaining('recordRoutes.wrong has plural'))
  })

  it('reports route config mapping and singular slug mismatches', () => {
    const { contents, check } = fixture()
    contents.set(paths.client, "export const kinds = { alpha: { slug: 'wrong', slugs: 'alphas' } }")
    contents.set(
      paths.routes,
      contents.get(paths.routes)!.replace("kinds: ['entry']", "kinds: ['wrong']"),
    )
    expect(check()).toContainEqual(expect.stringContaining('kinds.alpha.slug is "wrong"'))
    expect(check()).toContainEqual(expect.stringContaining('recordRoutes.entries maps'))
  })

  it('reports malformed second-family declarations without throwing', () => {
    const { contents, check } = fixture()
    contents.set(paths.union, 'type Wrong = 1')
    expect(check()).toContainEqual(
      expect.stringContaining(
        `::error file=${paths.union}::${paths.union}: could not parse RecordKind union`,
      ),
    )
  })

  it('reads selected tracked files from repoRoot when a shared reader is absent', () => {
    const { ctx, contents, check } = fixture()
    const root = mkdtempSync(join(tmpdir(), 'finite-enum-'))
    try {
      for (const [file, content] of contents) {
        const target = join(root, file)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content)
      }
      ctx.repoRoot = root
      delete ctx.readTrackedFile
      expect(check()).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports selected files that are not tracked or cannot be read', () => {
    const { files, ctx, check } = fixture()
    files.structuredDetailPages.push({
      file: 'ui/missing/page.tsx',
      slug: 'alpha',
      isTopLevel: false,
    })
    expect(check()).toContainEqual(
      expect.stringContaining('::error file=ui/missing/page.tsx::ui/missing/page.tsx: Not tracked'),
    )
    files.structuredDetailPages.pop()
    ctx.readTrackedFile = (file) =>
      file === paths.source ? null : (fixture().contents.get(file) ?? null)
    expect(check()).toContainEqual(
      expect.stringContaining(
        `::error file=${paths.source}::${paths.source}: Cannot read tracked file`,
      ),
    )
  })

  it('reports component files without a matching configured route', () => {
    const { files, check } = fixture()
    files.structuredComponentFiles.push({ file: 'ui/other/nav.tsx', slug: 'other' })
    expect(check()).toContainEqual(
      expect.stringContaining('component has no matching route config'),
    )
  })

  it('skips record checks when a required tracked declaration is missing', () => {
    const { files, check } = fixture()
    files.existingFileSet = new Set(
      [...files.existingFileSet].filter((file) => file !== paths.union),
    )
    expect(check()).toEqual([])
  })

  it('uses caller-defined path and navigation layouts and diagnostic suffix', () => {
    const { contents, config, check } = fixture()
    contents.set(paths.collection, "export default { href: '/wrong' }")
    contents.set(paths.component, "navigate('/wrong')")
    config.structured!.collectionPathLiteralPattern = /\bhref:\s*['"]\/([^'"]*)['"]/g
    config.structured!.navigationPathLiteralPattern = /\bnavigate\(\s*['"]\/([^'"]+)/g
    config.diagnosticSuffix = ' Follow local guide.'
    expect(check()).toContainEqual(expect.stringContaining('kind collection path literal "/wrong"'))
    expect(check()).toContainEqual(
      expect.stringContaining('kind component navigation path "/wrong"'),
    )
    expect(check().every((error) => error.endsWith(' Follow local guide.'))).toBe(true)
  })

  it('accepts either optional family and reports non-Error provider failures', () => {
    const { ctx, config, check } = fixture()
    delete config.structured
    expect(check()).toEqual([])
    ctx.readTrackedFile = () => {
      throw 'provider unavailable'
    }
    expect(check()).toContainEqual(expect.stringContaining('provider unavailable'))
    delete config.union
    expect(check()).toEqual([])
  })

  it('skips absent optional route configuration and reports extra routes', () => {
    const { files, contents, check } = fixture()
    files.existingFileSet = new Set(
      [...files.existingFileSet].filter((file) => file !== paths.routes),
    )
    expect(check()).toEqual([])
    files.existingFileSet = new Set(contents.keys())
    contents.set(paths.routes, contents.get(paths.routes)!.replace('kindRoutes', 'otherRoutes'))
    files.structuredDetailPages.push({ file: paths.detail, slug: 'extra', isTopLevel: true })
    expect(check()).toContainEqual(expect.stringContaining('kind route directories mismatch'))
  })

  it('reports unknown configured kinds, multi-kind create routes, and missing mapped record type', () => {
    const { contents, files, check } = fixture()
    files.unionDetailPages[0]!.slug = 'unknown'
    contents.set(
      paths.routes,
      contents
        .get(paths.routes)!
        .replace("kinds: ['alpha']", "kinds: ['ghost']")
        .replace("kinds: ['entry']", "kinds: ['entry', 'other']")
        .replace("singular: 'entry'", "singular: 'unknown'"),
    )
    expect(check()).toContainEqual(expect.stringContaining('kindRoutes.alphas maps'))
    expect(check()).toContainEqual(expect.stringContaining('recordRoutes.entries maps'))
    expect(check()).toContainEqual(expect.stringContaining('expected type is "missing"'))
  })

  it('filters consumer-ignored navigation paths', () => {
    const { contents, config, check } = fixture()
    contents.set(paths.component, "push('/ignored')")
    config.structured!.ignoredNavigationPaths = ['ignored']
    expect(check()).toEqual([])
  })

  it('returns non-Error source-reader failures as diagnostics', () => {
    const { ctx, config, check } = fixture()
    delete config.union
    ctx.readTrackedFile = () => {
      throw 'source unavailable'
    }
    expect(check()).toContainEqual(expect.stringContaining('source unavailable'))
  })

  it('reports backend-only and web-only members', () => {
    const { contents, check } = fixture()
    contents.set(paths.client, "export const kinds = { beta: { slug: 'beta', slugs: 'betas' } }")
    expect(check()).toContainEqual(expect.stringContaining('missing from ui/kinds.ts kinds: alpha'))
    expect(check()).toContainEqual(expect.stringContaining('stale in ui/kinds.ts kinds: beta'))
  })

  it('ignores route declaration names in comments when the declaration is absent', () => {
    const { contents, check } = fixture()
    contents.set(
      paths.routes,
      contents
        .get(paths.routes)!
        .replace('kindRoutes', 'otherKindRoutes')
        .replace('recordRoutes', 'otherRecordRoutes') +
        '\n// kindRoutes and recordRoutes are examples',
    )
    expect(check()).toEqual([])
  })

  it('does not treat commented or quoted create-page examples as active values', () => {
    const { contents, check } = fixture()
    contents.set(
      paths.recordCreate,
      [
        "const form = { action: 'entry' }",
        "// action: 'old'",
        'const example = "unionType: \'old\'"',
      ].join('\n'),
    )
    expect(check()).toEqual([])
    contents.set(paths.recordCreate, "const form = { action: 'old' }")
    expect(check()).toContainEqual(expect.stringContaining('create page literal uses "old"'))
  })

  it('reports an unsupported mixed union as a diagnostic', () => {
    const { contents, check } = fixture()
    contents.set(paths.union, "type RecordKind = 'entry' | ExternalKinds | 'internal'")
    expect(check()).toContainEqual(
      expect.stringContaining('union contains a non-string literal constituent'),
    )
  })

  it('annotates a real selected file and escapes workflow-command delimiters', () => {
    const { contents, files, config, check } = fixture()
    const client = 'ui/kinds,%.ts'
    contents.set(client, "export const kinds = { beta: { slug: 'beta', slugs: 'betas' } }")
    files.existingFileSet = new Set([...files.existingFileSet, client])
    config.structured!.webPath = client
    config.diagnosticSuffix = ' Guidance 100%\nnext line'
    const errors = check()
    expect(errors).toContainEqual(expect.stringContaining('::error file=ui/kinds%2C%25.ts::'))
    expect(errors.every((error) => error.endsWith(' Guidance 100%25%0Anext line'))).toBe(true)
    files.structuredDetailPages = []
    expect(check()).toContainEqual(expect.stringContaining(`::error file=${paths.source}::`))
  })

  it('blames only the route config for duplicate route values', () => {
    const { contents, check } = fixture()
    contents.set(
      paths.routes,
      contents.get(paths.routes)!.replace("kinds: ['alpha']", "kinds: ['alpha', 'alpha']"),
    )
    const duplicates = check().filter((error) => error.includes('route config values duplicate'))
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]).toContain('duplicate in actual values: alpha')
  })

  it('uses declaration paths when routed-page lists are empty', () => {
    const { files, check } = fixture()
    files.structuredCollectionPages = []
    files.unionCollectionPages = []
    files.unionDetailPages = []
    expect(check()).toContainEqual(expect.stringContaining(`::error file=${paths.routes}::`))
  })

  it('ignores inactive route and navigation examples but checks active literals', () => {
    const { contents, check } = fixture()
    contents.set(
      paths.collection,
      "const note = \"path: '/old'\"; // path: '/old'\nexport default { path: '/alphas' }",
    )
    contents.set(paths.component, "const note = \"push('/old')\"; // push('/old')\npush('/alphas')")
    expect(check()).toEqual([])
    contents.set(
      paths.collection,
      contents.get(paths.collection)!.replace("path: '/alphas'", "path: '/old'"),
    )
    contents.set(
      paths.component,
      contents.get(paths.component)!.replace("push('/alphas')", "push('/old')"),
    )
    expect(check()).toContainEqual(expect.stringContaining('collection path literal "/old"'))
    expect(check()).toContainEqual(expect.stringContaining('component navigation path "/old"'))
  })

  it('returns an annotation for a matched factory with a dynamic slug', () => {
    const { contents, check } = fixture()
    contents.set(paths.detail, 'const Page = createKindPage(dynamicSlug)')
    expect(check()).toContainEqual(
      expect.stringContaining(
        `::error file=${paths.detail}::${paths.detail}: configured route factory call needs a string literal slug`,
      ),
    )
  })

  it('ignores empty collection captures but rejects root navigation paths', () => {
    const { contents, config, check } = fixture()
    contents.set(paths.collection, "export default { path: '/' }")
    contents.set(paths.component, "push('/')")
    config.structured!.navigationPathLiteralPattern = /\bpush\(\s*['"]\/([^'"]*)/g
    expect(check()).not.toContainEqual(expect.stringContaining('collection path literal "/"'))
    expect(check()).toContainEqual(expect.stringContaining('component navigation path "/"'))
  })

  it('attributes a fallback filesystem read failure to its selected page', () => {
    const { contents, ctx, check } = fixture()
    const root = mkdtempSync(join(tmpdir(), 'finite-enum-missing-page-'))
    try {
      for (const [file, content] of contents) {
        if (file === paths.detail) continue
        const target = join(root, file)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content)
      }
      ctx.repoRoot = root
      delete ctx.readTrackedFile
      expect(check()).toContainEqual(
        expect.stringContaining(`::error file=${paths.detail}::${paths.detail}:`),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
