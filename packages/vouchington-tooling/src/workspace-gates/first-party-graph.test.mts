import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { checkWorkspaceGatesPolicy } from './index.mts'
import { checkTemporaryReleaseAgeSelectorsInLockfile } from './first-party-graph.mts'
import {
  FIRST_PARTY_NAMES,
  TEMPORARY_SELECTOR,
  buildDependabotYaml,
  buildPackageJson,
  buildPnpmLock,
  defaultOptions,
  makeCompliantFixture,
  makeTmpDir,
  stubCtx,
  writeTracked,
} from './test-helpers.mts'
import type { SharedContext } from '../shared-context/index.mts'

describe('workspace-gates first-party graph', () => {
  const testDirs: string[] = []

  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('flags an active scoped package missing from the registry and a stale registry name', async () => {
    const missing = await makeCompliantFixture(testDirs, {
      names: [...FIRST_PARTY_NAMES, '@acme/new-tool'],
      lockKeys: ['acme-lib@1.0.0', '@acme/core@1.0.0', '@acme/new-tool@1.0.0'],
    })
    const stale = await makeCompliantFixture(testDirs, {
      names: ['acme-lib'],
      lockKeys: ['acme-lib@1.0.0'],
    })

    const missingErrors = await checkWorkspaceGatesPolicy(
      stubCtx(missing.dir, missing.files),
      defaultOptions(),
    )
    const staleErrors = await checkWorkspaceGatesPolicy(
      stubCtx(stale.dir, stale.files),
      defaultOptions(),
    )

    expect(
      missingErrors.errors.some((error) =>
        error.includes('active first-party package "@acme/new-tool"'),
      ),
    ).toBe(true)
    expect(
      staleErrors.errors.some((error) => error.includes('"@acme/core" is registered but absent')),
    ).toBe(true)
  })

  it('skips scoped-prefix discovery when prefixes are empty', async () => {
    const { dir, files } = await makeCompliantFixture(testDirs, {
      names: [...FIRST_PARTY_NAMES, '@acme/new-tool'],
      lockKeys: ['acme-lib@1.0.0', '@acme/core@1.0.0', '@acme/new-tool@1.0.0'],
    })
    const { errors } = await checkWorkspaceGatesPolicy(
      stubCtx(dir, files),
      defaultOptions({ scopedPrefixes: [] }),
    )
    expect(
      errors.some((error) => error.includes('active first-party package "@acme/new-tool"')),
    ).toBe(false)
  })

  it('flags unreadable and malformed package.json files', async () => {
    const unreadable = await makeCompliantFixture(testDirs)
    await rm(join(unreadable.dir, 'package.json'))
    await mkdir(join(unreadable.dir, 'package.json'))
    const malformed = await makeCompliantFixture(testDirs, {
      extraFiles: { 'package.json': '{ invalid json' },
    })

    expect(
      (
        await checkWorkspaceGatesPolicy(stubCtx(unreadable.dir, unreadable.files), defaultOptions())
      ).errors.some((error) => error.includes('failed to read package.json')),
    ).toBe(true)
    expect(
      (
        await checkWorkspaceGatesPolicy(stubCtx(malformed.dir, malformed.files), defaultOptions())
      ).errors.some((error) => error.includes('failed to parse package.json')),
    ).toBe(true)
  })

  it('ignores non-object manifests and non-object dependency maps', async () => {
    const dir = await makeTmpDir(testDirs)
    const files = await writeTracked(dir, {
      'pnpm-workspace.yaml': "minimumReleaseAgeExclude:\n  - 'acme-lib'\n  - '@acme/core'\n",
      '.github/dependabot.yml':
        "updates:\n  - package-ecosystem: 'npm'\n    directory: '/'\n    cooldown:\n      exclude:\n        - 'acme-lib'\n        - '@acme/core'\n",
      'package.json': '[]\n',
      'packages/app/package.json': JSON.stringify({
        dependencies: ['not-a-map'],
        devDependencies: null,
        optionalDependencies: 'nope',
        peerDependencies: { 'acme-lib': '1.0.0', '@acme/core': '1.0.0' },
      }),
      'pnpm-lock.yaml': buildPnpmLock(),
    })
    const { errors } = await checkWorkspaceGatesPolicy(stubCtx(dir, files), defaultOptions())
    expect(errors).toEqual([])
  })

  it('covers lockfile shapes, orphans, and unreadable lockfiles', async () => {
    const orphan = await makeCompliantFixture(testDirs)
    const unreadable = await makeCompliantFixture(testDirs)
    await rm(join(unreadable.dir, 'pnpm-lock.yaml'))
    await mkdir(join(unreadable.dir, 'pnpm-lock.yaml'))
    const malformed = await makeCompliantFixture(testDirs, {
      extraFiles: { 'pnpm-lock.yaml': '{ invalid yaml: }}}' },
    })
    const listPackages = await makeCompliantFixture(testDirs, {
      extraFiles: {
        'package.json': '{}\n',
        'pnpm-lock.yaml': "lockfileVersion: '9.0'\npackages: []\n",
      },
    })
    const scalarPackages = await makeCompliantFixture(testDirs, {
      extraFiles: { 'pnpm-lock.yaml': "lockfileVersion: '9.0'\npackages: true\n" },
    })
    const nullPackages = await makeCompliantFixture(testDirs, {
      extraFiles: { 'pnpm-lock.yaml': "lockfileVersion: '9.0'\npackages: null\n" },
    })
    const skipped = await makeCompliantFixture(testDirs)

    expect(
      (
        await checkWorkspaceGatesPolicy(
          stubCtx(orphan.dir, orphan.files),
          defaultOptions({ temporarySelectors: [TEMPORARY_SELECTOR] }),
        )
      ).errors.some((error) => error.includes('absent from tracked pnpm-lock.yaml packages')),
    ).toBe(true)
    expect(
      (
        await checkWorkspaceGatesPolicy(stubCtx(unreadable.dir, unreadable.files), defaultOptions())
      ).errors.some((error) => error.includes('failed to read YAML')),
    ).toBe(true)
    expect(
      (
        await checkWorkspaceGatesPolicy(stubCtx(malformed.dir, malformed.files), defaultOptions())
      ).errors.some((error) => error.includes('failed to parse YAML')),
    ).toBe(true)
    expect(
      (
        await checkWorkspaceGatesPolicy(
          stubCtx(listPackages.dir, listPackages.files),
          defaultOptions(),
        )
      ).errors.some((error) => error.includes('registered but absent')),
    ).toBe(true)
    expect(
      (
        await checkWorkspaceGatesPolicy(
          stubCtx(scalarPackages.dir, scalarPackages.files),
          defaultOptions(),
        )
      ).errors,
    ).toEqual([])
    expect(
      (
        await checkWorkspaceGatesPolicy(
          stubCtx(nullPackages.dir, nullPackages.files),
          defaultOptions(),
        )
      ).errors,
    ).toEqual([])
    expect(
      (
        await checkWorkspaceGatesPolicy(
          stubCtx(
            skipped.dir,
            skipped.files.filter((file) => file !== 'pnpm-lock.yaml'),
          ),
          defaultOptions({ temporarySelectors: [TEMPORARY_SELECTOR] }),
        )
      ).errors.some((error) => error.includes('absent from tracked pnpm-lock.yaml packages')),
    ).toBe(true)
  })

  it('accepts matching lockfile selector shapes and skips malformed keys', async () => {
    async function checkSelector(selector: string, key: string): Promise<string[]> {
      const repoRoot = await makeTmpDir(testDirs)
      await writeFile(join(repoRoot, 'pnpm-lock.yaml'), buildPnpmLock([key]))
      const errors: string[] = []
      const ctx: SharedContext = {
        repoRoot,
        isInsideGitRepo: true,
        trackedFiles: ['pnpm-lock.yaml'],
        trackedFileSet: new Set(['pnpm-lock.yaml']),
      }
      await checkTemporaryReleaseAgeSelectorsInLockfile(ctx, errors, [selector], 'pnpm-lock.yaml')
      return errors
    }

    expect(await checkSelector('demo-package@9.9.9', 'demo-package@9.9.9')).toEqual([])
    expect(await checkSelector('@scope/demo-package@9.9.9', '@scope/demo-package@9.9.9')).toEqual(
      [],
    )
    expect(await checkSelector('demo-package@9.9.9', '/demo-package@9.9.9')).toEqual([])
    expect(await checkSelector('demo-package@9.9.9', 'demo-package@9.9.9(peer@1.0.0)')).toEqual([])
    expect(await checkSelector('demo-package@9.9.9', 'demo-package@9.9.9(patch_hash=abc)')).toEqual(
      [],
    )
    expect(await checkSelector('demo-package@9.9.9', 'demo-package@9.9.9_peer@1.0.0')).toEqual([])

    const dir = await makeTmpDir(testDirs)
    const files = await writeTracked(dir, {
      'pnpm-workspace.yaml': "minimumReleaseAgeExclude:\n  - 'acme-lib'\n  - '@acme/core'\n",
      '.github/dependabot.yml': buildDependabotYaml(),
      'package.json': buildPackageJson(),
      'pnpm-lock.yaml': buildPnpmLock(['acme-lib@1.0.0', '@acme/core@1.0.0', '@scope']),
    })
    expect((await checkWorkspaceGatesPolicy(stubCtx(dir, files), defaultOptions())).errors).toEqual(
      [],
    )
  })

  it('treats a scalar package.json as having no dependencies', async () => {
    const dir = await makeTmpDir(testDirs)
    const files = await writeTracked(dir, {
      'pnpm-workspace.yaml': "minimumReleaseAgeExclude:\n  - 'acme-lib'\n  - '@acme/core'\n",
      '.github/dependabot.yml': buildDependabotYaml(),
      'package.json': '"nope"\n',
      'pnpm-lock.yaml': buildPnpmLock(),
    })
    const { errors } = await checkWorkspaceGatesPolicy(stubCtx(dir, files), defaultOptions())
    expect(errors).toEqual([])
  })
})
