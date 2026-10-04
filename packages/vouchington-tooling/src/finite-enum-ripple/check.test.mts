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
    [paths.recordCreate, "const form = { action: 'entry', postType: 'entry' }"],
  ])
  const pages = (file: string, slug: string) => [{ file, slug, isTopLevel: true }]
  const files: FiniteEnumFiles = {
    existingFileSet: new Set(contents.keys()),
    topicDetailPages: pages(paths.detail, 'alpha'),
    topicCollectionPages: pages(paths.collection, 'alphas'),
    topicComponentFiles: [{ file: paths.component, slug: 'alphas' }],
    postDetailPages: pages(paths.recordDetail, 'entry'),
    postCollectionPages: pages(paths.recordCollection, 'entries'),
    postCreatePages: pages(paths.recordCreate, 'entries'),
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
    topic: {
      backendPath: paths.source,
      webPath: paths.client,
      routeConfigsPath: paths.routes,
      typeObject: 'kinds',
      routeConfigObject: 'kindRoutes',
      typeArrayProperty: 'kinds',
      spendingCategoryProperty: 'special',
      slugProperty: 'slug',
      slugPluralProperty: 'slugs',
      pluralPathProperty: 'plural',
      singularPathProperty: 'singular',
      factoryCallPattern: /^createKindPage$/,
      routeConfigExceptions: [],
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
    post: {
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
      createPageTypeProperties: ['action', 'postType'],
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
  it('accepts configured compact declarations and matching routes', () => {
    expect(fixture().check()).toEqual([])
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
    files.topicDetailPages = [{ file: paths.detail, slug: 'alpha', isTopLevel: false }]
    expect(check()).toContainEqual(expect.stringContaining('kind route directories mismatch'))
    expect(check()).not.toContainEqual(expect.stringContaining('kind routed pages mismatch'))
  })

  it('checks route config and factory mismatches', () => {
    const { contents, check } = fixture()
    contents.set(
      paths.routes,
      contents.get(paths.routes)!.replace("singular: 'alpha'", "singular: 'wrong'"),
    )
    contents.set(paths.detail, "const Page = createKindPage('wrong')")
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
    expect(check()).toContain(`${paths.source}: could not find end of kinds`)
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
    expect(check()).toContain(`${paths.union}: could not parse RecordKind union`)
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
    files.topicDetailPages.push({ file: 'ui/missing/page.tsx', slug: 'alpha', isTopLevel: false })
    expect(check()).toContain('Not tracked: ui/missing/page.tsx')
    files.topicDetailPages.pop()
    ctx.readTrackedFile = (file) =>
      file === paths.source ? null : (fixture().contents.get(file) ?? null)
    expect(check()).toContain(`Cannot read tracked file: ${paths.source}`)
  })

  it('skips component files without a matching configured route', () => {
    const { files, check } = fixture()
    files.topicComponentFiles.push({ file: 'ui/other/nav.tsx', slug: 'other' })
    expect(check()).toEqual([])
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
    config.topic!.collectionPathLiteralPattern = /\bhref:\s*['"]\/([^'"]*)['"]/g
    config.topic!.navigationPathLiteralPattern = /\bnavigate\(\s*['"]\/([^'"]+)/g
    config.diagnosticSuffix = ' Follow local guide.'
    expect(check()).toContainEqual(expect.stringContaining('kind collection path literal "/wrong"'))
    expect(check()).toContainEqual(
      expect.stringContaining('kind component navigation path "/wrong"'),
    )
    expect(check().every((error) => error.endsWith(' Follow local guide.'))).toBe(true)
  })
})
