import { describe, expect, it } from 'vitest'

import { DiffCommandError } from '../gh-cli/index.mts'
import {
  buildRemovalVocabulary,
  createAppRouterPathParser,
  createDiffSummary,
  createGhPackageJsonReader,
  createLocalPackageJsonReader,
  findRemovedScripts,
  parseChangedPackageJsonPaths,
  parseRemovedExports,
  parseRemovedSurfaces,
  readPullRequestPatch,
  reduceDiffBlock,
  type PullRequestIdentity,
  type RemovedSurface,
} from './index.mts'

describe('removed-exports', () => {
  it('detects star, named, multiline, aliased, and declared export removals while skipping re-added names', () => {
    const block = [
      'diff --git a/src/index.mts b/src/index.mts',
      '--- a/src/index.mts',
      '+++ b/src/index.mts',
      '-export * from "./legacy.mts"',
      '-export { alpha as beta, gamma, } from "./a.mts"',
      '+export { gamma } from "./a.mts"',
      '-export async function droppedFn() {}',
      '-export type RemovedType = string',
      ' export {',
      '-  multiRemoved,',
      '-  multiKept,',
      '+  multiKept,',
      '   unchanged,',
      ' }',
      '-notAnExport()',
    ].join('\n')

    expect(parseRemovedExports(block, 'src/index.mts')).toEqual([
      { name: 'legacy', path: 'src/index.mts', type: 'removed-export' },
      { name: 'beta', path: 'src/index.mts', type: 'removed-export' },
      { name: 'droppedFn', path: 'src/index.mts', type: 'removed-export' },
      { name: 'RemovedType', path: 'src/index.mts', type: 'removed-export' },
      { name: 'multiRemoved', path: 'src/index.mts', type: 'removed-export' },
    ])
  })
})

describe('removed-surfaces and diff-summary', () => {
  it('parses deleted files, routes via caller parser, renamed routes, and changed package.json paths', () => {
    const parseRoute = createAppRouterPathParser('web/app/')
    expect(parseRoute('web/app/page.tsx')).toBe('/')
    expect(parseRoute('web/app/(marketing)/pricing/page.tsx')).toBe('/pricing')
    expect(parseRoute('web/app/layout.tsx')).toBeUndefined()
    expect(createAppRouterPathParser('/')('page.tsx')).toBe('/')

    const patch = [
      'diff --git a/web/app/(admin)/billing/page.tsx b/web/app/(admin)/billing/page.tsx',
      'deleted file mode 100644',
      'diff --git a/web/app/old/route.ts b/web/app/new/route.ts',
      'rename from web/app/old/route.ts',
      'rename to web/app/new/route.ts',
      'diff --git a/web/app/other/layout.tsx b/web/app/other/layout2.tsx',
      'rename from web/app/other/layout.tsx',
      'rename to web/app/other/layout2.tsx',
      'diff --git a/deleted-only b/deleted-only',
      'deleted file mode 100644',
      'diff --git malformed',
      'deleted file mode 100644',
      'diff --git a/packages/a/package.json b/packages/a/package.json',
      '--- a/packages/a/package.json',
      '+++ b/packages/a/package.json',
      '-  "old": "1"',
      'diff --git a/packages/b/package.json b/packages/b/package.json',
      'deleted file mode 100644',
      '--- a/packages/b/package.json',
      '+++ /dev/null',
    ].join('\r\n')

    const surfaces = parseRemovedSurfaces(patch, { parseRouteFromPath: parseRoute })
    expect(surfaces).toEqual([
      { path: 'web/app/(admin)/billing/page.tsx', type: 'deleted-file' },
      { path: 'web/app/(admin)/billing/page.tsx', route: '/billing', type: 'removed-route' },
      { path: 'web/app/old/route.ts', route: '/old', type: 'removed-route' },
      { path: 'deleted-only', type: 'deleted-file' },
      { path: 'packages/b/package.json', type: 'deleted-file' },
    ])
    expect(parseChangedPackageJsonPaths(patch)).toEqual(['packages/a/package.json'])
    expect(
      parseChangedPackageJsonPaths('diff --git a/src/a.mts b/src/a.mts\n+++ b/src/a.mts\n'),
    ).toEqual([])
    expect(parseRemovedSurfaces('')).toEqual([])
  })

  it('builds bounded, prioritized, deduplicated removal vocabulary', () => {
    const surfaces: RemovedSurface[] = [
      { name: 'db:old-script', path: 'package.json', type: 'removed-script' },
      { name: 'typecheck', path: 'package.json', type: 'removed-script' },
      { path: 'web/app/page.tsx', route: '/', type: 'removed-route' },
      { path: 'web/app/settings/[id]/page.tsx', route: '/settings/[id]', type: 'removed-route' },
      { path: 'web/app/[id]/page.tsx', route: '/[id]', type: 'removed-route' },
      { name: 'CustomExport', path: 'a.mts', type: 'removed-export' },
      { name: 'customexport', path: 'b.mts', type: 'removed-export' },
      { name: 'utils', path: 'c.mts', type: 'removed-export' },
      { name: 'abc', path: 'd.mts', type: 'removed-export' },
      { path: 'src/retired.mts', type: 'deleted-file' },
    ]
    const vocab = buildRemovalVocabulary(surfaces, 4)
    expect(vocab.terms).toEqual(['"src/retired.mts"', 'CustomExport', '"/settings"', '"/[id]"'])
    expect(vocab.dropped).toEqual(['utils', 'abc', '"/"', '"db:old-script"', 'typecheck'])
  })

  it('accumulates diff summaries without duplicating package.json paths', () => {
    const summary = createDiffSummary()
    const block = [
      'diff --git a/package.json b/package.json',
      '--- a/package.json',
      '+++ b/package.json',
      '+  "a": "1",',
      '-  "b": "2",',
    ].join('\n')
    reduceDiffBlock(summary, block)
    reduceDiffBlock(summary, block)
    expect(summary.lineChanges).toEqual({ added: 2, deleted: 2 })
    expect(summary.changedPackageJsonPaths).toEqual(['package.json'])
  })
})

describe('removed-scripts and package-json-source', () => {
  it('finds removed scripts and degrades cleanly on missing or invalid JSON', async () => {
    const reader = (path: string, side: 'base' | 'head'): Promise<string | undefined> => {
      if (path === 'valid/package.json') {
        return Promise.resolve(
          side === 'base'
            ? JSON.stringify({ scripts: { keep: '1', drop: '2' } })
            : JSON.stringify({ scripts: { keep: '1' } }),
        )
      }
      if (path === 'bad/package.json') return Promise.resolve('{invalid')
      if (path === 'array/package.json') return Promise.resolve('[]')
      if (path === 'no-scripts/package.json')
        return Promise.resolve(JSON.stringify({ scripts: [] }))
      return Promise.resolve(undefined)
    }

    await expect(
      findRemovedScripts(
        [
          'valid/package.json',
          'bad/package.json',
          'array/package.json',
          'no-scripts/package.json',
          'missing/package.json',
        ],
        reader,
      ),
    ).resolves.toEqual([{ name: 'drop', path: 'valid/package.json', type: 'removed-script' }])
  })

  it('creates local and GitHub package.json readers with memoized merge-base resolution', async () => {
    let gitCalls = 0
    const localReader = createLocalPackageJsonReader((args) => {
      gitCalls += 1
      if (args[0] === 'merge-base') return Promise.resolve('base-sha\n')
      if (args[1] === 'HEAD:missing.json') return Promise.reject(new Error('missing'))
      return Promise.resolve(`content:${args[1]}`)
    })
    await expect(localReader('package.json', 'base')).resolves.toBe('content:base-sha:package.json')
    await expect(localReader('a/package.json', 'base')).resolves.toBe(
      'content:base-sha:a/package.json',
    )
    await expect(localReader('package.json', 'head')).resolves.toBe('content:HEAD:package.json')
    await expect(localReader('missing.json', 'head')).resolves.toBeUndefined()
    expect(gitCalls).toBe(5)

    const ghReader = createGhPackageJsonReader(
      (args) => {
        if (args[1]?.includes('/compare/')) {
          return Promise.resolve(JSON.stringify({ merge_base_commit: { sha: 'mb123' } }))
        }
        if (args[3]?.includes('missing')) return Promise.reject(new Error('404'))
        return Promise.resolve(`raw:${args[5]}`)
      },
      'acme/repo',
      'base',
      'head',
    )
    await expect(ghReader('package.json', 'base')).resolves.toBe('raw:ref=mb123')
    await expect(ghReader('package.json', 'head')).resolves.toBe('raw:ref=head')
    await expect(ghReader('missing', 'head')).resolves.toBeUndefined()

    const badCompare = createGhPackageJsonReader(
      () => Promise.resolve(JSON.stringify({})),
      'acme/repo',
      'base',
      'head',
    )
    await expect(badCompare('package.json', 'base')).resolves.toBeUndefined()
  })
})

describe('readPullRequestPatch', () => {
  const TARGET: PullRequestIdentity = {
    mergeCommitOid: undefined,
    number: 9,
    owner: 'acme',
    repo: 'repo',
    state: 'OPEN',
  }

  it('reduces unified diff directly and rethrows non-DiffCommandError failures', async () => {
    const unified = await readPullRequestPatch(
      async (onBlock) => {
        await onBlock('diff --git a/x.mts b/x.mts\ndeleted file mode 100644')
      },
      () => Promise.reject(new Error('unused')),
      TARGET,
    )
    expect(unified.source).toBe('unified-diff')
    expect(unified.summary.removedSurfaces).toEqual([{ path: 'x.mts', type: 'deleted-file' }])

    await expect(
      readPullRequestPatch(
        () => Promise.reject(new TypeError('unexpected')),
        () => Promise.resolve('[]'),
        TARGET,
      ),
    ).rejects.toThrow('unexpected')
  })

  it('falls back to files API on DiffCommandError and rethrows original error if fallback fails', async () => {
    const diffErr = new DiffCommandError(
      { args: ['pr', 'diff'], executable: 'gh' },
      { stderr: '406' },
    )
    const fallback = await readPullRequestPatch(
      () => Promise.reject(diffErr),
      () =>
        Promise.resolve(
          JSON.stringify([
            { filename: 'old.mts', status: 'removed' },
            { filename: 'new.mts', patch: '+export const a = 1', status: 'added' },
            { filename: 'renamed.mts', previous_filename: 'before.mts', status: 'renamed' },
            { filename: 'mod.mts', patch: '-export const gone = 1', status: 'modified' },
          ]),
        ),
      TARGET,
    )
    expect(fallback.source).toBe('files-api')
    expect(fallback.summary.removedSurfaces).toEqual([
      { path: 'old.mts', type: 'deleted-file' },
      { name: 'gone', path: 'mod.mts', type: 'removed-export' },
    ])

    await expect(
      readPullRequestPatch(
        () => Promise.reject(diffErr),
        () => Promise.reject(new Error('api failed')),
        TARGET,
      ),
    ).rejects.toBe(diffErr)
  })

  it('checks total changed_files when all 150 pages fill completely', async () => {
    const diffErr = new DiffCommandError(
      { args: ['pr', 'diff'], executable: 'gh' },
      { stderr: '406' },
    )
    const fullBatch = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({ filename: `f${i}.mts`, status: 'modified' })),
    )

    const exact = await readPullRequestPatch(
      () => Promise.reject(diffErr),
      (args) => Promise.resolve(args[1]?.endsWith('/files') ? fullBatch : '3000'),
      TARGET,
    )
    expect(exact.source).toBe('files-api')

    await expect(
      readPullRequestPatch(
        () => Promise.reject(diffErr),
        (args) => Promise.resolve(args[1]?.endsWith('/files') ? fullBatch : '3001'),
        TARGET,
      ),
    ).rejects.toBe(diffErr)
  })
})
