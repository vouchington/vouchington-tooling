import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { checkWorkspaceGatesPolicy } from './index.mts'
import type { ReleaseAgeExemptionGroup } from '../pnpm-install/index.mts'
import {
  FIRST_PARTY_NAMES,
  SCOPED_PREFIXES,
  TEMPORARY_SELECTOR,
  buildDependabotYaml,
  buildWorkspaceYaml,
  defaultOptions,
  makeCompliantFixture,
  makeTmpDir,
  stubCtx,
  writeTracked,
  buildPnpmLock,
} from './test-helpers.mts'

const temporaryGroup: ReleaseAgeExemptionGroup = {
  selectors: [TEMPORARY_SELECTOR],
  reason: 'Fixture exemption for workspace-gates tests.',
  eligibleForRemovalAt: '2099-01-01T00:00:00Z',
}

describe('checkWorkspaceGatesPolicy', () => {
  const testDirs: string[] = []

  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('passes on a fully compliant fixture', async () => {
    const { dir, files } = await makeCompliantFixture(testDirs)
    const { errors } = await checkWorkspaceGatesPolicy(stubCtx(dir, files), defaultOptions())
    expect(errors).toEqual([])

    const temporary = await makeCompliantFixture(testDirs, {
      extraFiles: {
        'pnpm-workspace.yaml': buildWorkspaceYaml([...FIRST_PARTY_NAMES, TEMPORARY_SELECTOR]),
        'pnpm-lock.yaml': buildPnpmLock([
          'acme-lib@1.0.0',
          '@acme/core@1.0.0',
          'demo-temporary-package@9.9.9',
        ]),
      },
    })
    expect(
      (
        await checkWorkspaceGatesPolicy(
          stubCtx(temporary.dir, temporary.files),
          defaultOptions({ temporarySelectors: [TEMPORARY_SELECTOR] }),
        )
      ).errors,
    ).toEqual([])
  })

  it('flags yaml exclude drift in both directions and duplicate entries', async () => {
    const extra = await makeCompliantFixture(testDirs, {
      extraFiles: {
        'pnpm-workspace.yaml': buildWorkspaceYaml([...FIRST_PARTY_NAMES, 'unknown-package']),
      },
    })
    const missing = await makeCompliantFixture(testDirs, {
      extraFiles: { 'pnpm-workspace.yaml': buildWorkspaceYaml(['acme-lib']) },
    })
    const duplicate = await makeCompliantFixture(testDirs, {
      extraFiles: { 'pnpm-workspace.yaml': buildWorkspaceYaml([...FIRST_PARTY_NAMES, 'acme-lib']) },
    })

    const extraErrors = await checkWorkspaceGatesPolicy(
      stubCtx(extra.dir, extra.files),
      defaultOptions(),
    )
    const missingErrors = await checkWorkspaceGatesPolicy(
      stubCtx(missing.dir, missing.files),
      defaultOptions(),
    )
    const duplicateErrors = await checkWorkspaceGatesPolicy(
      stubCtx(duplicate.dir, duplicate.files),
      defaultOptions(),
    )

    expect(extraErrors.errors.some((error) => error.includes('"unknown-package"'))).toBe(true)
    expect(
      missingErrors.errors.some(
        (error) =>
          error.includes('"@acme/core"') && error.includes('missing from minimumReleaseAgeExclude'),
      ),
    ).toBe(true)
    expect(
      duplicateErrors.errors.some((error) =>
        error.includes('minimumReleaseAgeExclude duplicates "acme-lib"'),
      ),
    ).toBe(true)
  })

  it('flags a temporary selector missing from yaml when groups are supplied', async () => {
    const { dir, files } = await makeCompliantFixture(testDirs)
    const { errors } = await checkWorkspaceGatesPolicy(
      stubCtx(dir, files),
      defaultOptions({ temporaryGroups: [temporaryGroup] }),
    )
    expect(errors.some((error) => error.includes(`"${TEMPORARY_SELECTOR}"`))).toBe(true)
  })

  it('skips group validation when temporarySelectors are provided as strings', async () => {
    const invalid: ReleaseAgeExemptionGroup = {
      selectors: ['not-a-selector'],
      reason: ' ',
      eligibleForRemovalAt: 'nope',
    }
    const { dir, files } = await makeCompliantFixture(testDirs)
    const { errors } = await checkWorkspaceGatesPolicy(
      stubCtx(dir, files),
      defaultOptions({ temporarySelectors: [], temporaryGroups: [invalid] }),
    )
    expect(errors).toEqual([])
  })

  it('reports invalid temporary groups when selectors are omitted', async () => {
    const dir = await makeTmpDir(testDirs)
    const { errors } = await checkWorkspaceGatesPolicy(stubCtx(dir, []), {
      firstPartyNames: [],
      temporaryGroups: [
        {
          selectors: ['not-a-selector'],
          reason: ' ',
          eligibleForRemovalAt: 'nope',
        },
      ],
    })
    expect(errors.some((error) => error.includes('exact package@version selector'))).toBe(true)
  })

  it('treats a missing npm update as a no-op and flags cooldown glob misses', async () => {
    const missingNpm = await makeCompliantFixture(testDirs, {
      extraFiles: {
        '.github/dependabot.yml': 'updates:\n  - package-ecosystem: cargo\n    directory: /\n',
      },
    })
    const globMiss = await makeCompliantFixture(testDirs, {
      extraFiles: { '.github/dependabot.yml': buildDependabotYaml(['acme-lib']) },
    })
    const nonString = await makeCompliantFixture(testDirs, {
      extraFiles: {
        '.github/dependabot.yml': buildDependabotYaml([...FIRST_PARTY_NAMES, '123']).replace(
          "'123'",
          '123',
        ),
      },
    })

    expect(
      (await checkWorkspaceGatesPolicy(stubCtx(missingNpm.dir, missingNpm.files), defaultOptions()))
        .errors,
    ).toEqual([])
    const miss = await checkWorkspaceGatesPolicy(
      stubCtx(globMiss.dir, globMiss.files),
      defaultOptions(),
    )
    expect(
      miss.errors.some(
        (error) => error.includes('"@acme/core"') && error.includes('cooldown.exclude'),
      ),
    ).toBe(true)
    const typed = await checkWorkspaceGatesPolicy(
      stubCtx(nonString.dir, nonString.files),
      defaultOptions(),
    )
    expect(typed.errors.some((error) => error.includes('must be a string glob pattern'))).toBe(true)
  })

  it('covers glob cooldown matches, missing dependabot, and non-root npm entries', async () => {
    const glob = await makeCompliantFixture(testDirs, {
      extraFiles: { '.github/dependabot.yml': buildDependabotYaml(['acme-lib', '@acme/*']) },
    })
    const absent = await makeCompliantFixture(testDirs)
    await rm(join(absent.dir, '.github/dependabot.yml'))
    const nonRoot = await makeCompliantFixture(testDirs, {
      extraFiles: {
        '.github/dependabot.yml':
          "updates:\n  - package-ecosystem: 'npm'\n    directory: '/packages'\n    cooldown:\n      exclude:\n        - '*'\n",
      },
    })
    const emptyCooldown = await makeCompliantFixture(testDirs, {
      extraFiles: {
        '.github/dependabot.yml': "updates:\n  - package-ecosystem: 'npm'\n    directory: /\n",
      },
    })

    expect(
      (await checkWorkspaceGatesPolicy(stubCtx(glob.dir, glob.files), defaultOptions())).errors,
    ).toEqual([])
    expect(
      (
        await checkWorkspaceGatesPolicy(
          stubCtx(
            absent.dir,
            absent.files.filter((file) => file !== '.github/dependabot.yml'),
          ),
          defaultOptions(),
        )
      ).errors,
    ).toEqual([])
    expect(
      (await checkWorkspaceGatesPolicy(stubCtx(nonRoot.dir, nonRoot.files), defaultOptions()))
        .errors,
    ).toEqual([])
    const empty = await checkWorkspaceGatesPolicy(
      stubCtx(emptyCooldown.dir, emptyCooldown.files),
      defaultOptions(),
    )
    expect(empty.errors).toHaveLength(FIRST_PARTY_NAMES.length)
  })

  it('handles unreadable, malformed, non-mapping, and missing workspace yaml', async () => {
    const missing = await makeTmpDir(testDirs)
    const malformed = await makeTmpDir(testDirs)
    await writeFile(join(malformed, 'pnpm-workspace.yaml'), '{ invalid yaml: }}}')
    const unreadable = await makeTmpDir(testDirs)
    await mkdir(join(unreadable, 'pnpm-workspace.yaml'))
    const scalar = await makeTmpDir(testDirs)
    await writeFile(join(scalar, 'pnpm-workspace.yaml'), 'null\n')
    const list = await makeTmpDir(testDirs)
    await writeFile(join(list, 'pnpm-workspace.yaml'), '- not-a-mapping\n')
    const malformedDb = await makeCompliantFixture(testDirs, {
      extraFiles: { '.github/dependabot.yml': '{ invalid yaml: }}}' },
    })

    expect(
      (await checkWorkspaceGatesPolicy(stubCtx(missing, []), defaultOptions())).errors,
    ).toEqual([])
    expect(
      (
        await checkWorkspaceGatesPolicy(
          stubCtx(malformed, ['pnpm-workspace.yaml']),
          defaultOptions(),
        )
      ).errors[0],
    ).toContain('failed to parse YAML')
    expect(
      (
        await checkWorkspaceGatesPolicy(
          stubCtx(unreadable, ['pnpm-workspace.yaml']),
          defaultOptions(),
        )
      ).errors[0],
    ).toContain('failed to read YAML')
    expect(
      (await checkWorkspaceGatesPolicy(stubCtx(scalar, ['pnpm-workspace.yaml']), defaultOptions()))
        .errors,
    ).toEqual([])
    expect(
      (await checkWorkspaceGatesPolicy(stubCtx(list, ['pnpm-workspace.yaml']), defaultOptions()))
        .errors,
    ).toEqual([])
    expect(
      (
        await checkWorkspaceGatesPolicy(
          stubCtx(malformedDb.dir, malformedDb.files),
          defaultOptions(),
        )
      ).errors[0],
    ).toContain('dependabot.yml')
  })

  it('uses custom paths and labels, and ignores non-string yaml exclude entries', async () => {
    const dir = await makeTmpDir(testDirs)
    const files = await writeTracked(dir, {
      'workspace.yaml': `${buildWorkspaceYaml(['acme-lib', '@acme/core'])}  - 123\n`,
      'bots.yml': buildDependabotYaml(),
      'package.json': '{"dependencies":{"acme-lib":"1.0.0","@acme/core":"1.0.0"}}\n',
      'lock.yaml': buildPnpmLock(),
    })
    const { errors } = await checkWorkspaceGatesPolicy(stubCtx(dir, files), {
      firstPartyNames: FIRST_PARTY_NAMES,
      scopedPrefixes: SCOPED_PREFIXES,
      workspaceYamlPath: 'workspace.yaml',
      dependabotPath: 'bots.yml',
      lockfilePath: 'lock.yaml',
      firstPartyRegistryLabel: 'acme registry',
    })
    expect(errors).toEqual([])

    const missingLabel = await makeCompliantFixture(testDirs, {
      extraFiles: { 'pnpm-workspace.yaml': 'minimumReleaseAgeExclude: true\n' },
    })
    const unlabeled = await checkWorkspaceGatesPolicy(
      stubCtx(missingLabel.dir, missingLabel.files),
      defaultOptions({ firstPartyRegistryLabel: 'acme registry' }),
    )
    expect(unlabeled.errors.some((error) => error.includes('acme registry'))).toBe(true)
  })

  it('skips dependabot updates that are not objects', async () => {
    const { dir, files } = await makeCompliantFixture(testDirs, {
      extraFiles: { '.github/dependabot.yml': 'updates:\n  - just-a-string\n' },
    })
    const missingUpdates = await makeCompliantFixture(testDirs, {
      extraFiles: { '.github/dependabot.yml': 'version: 2\n' },
    })
    expect((await checkWorkspaceGatesPolicy(stubCtx(dir, files), defaultOptions())).errors).toEqual(
      [],
    )
    expect(
      (
        await checkWorkspaceGatesPolicy(
          stubCtx(missingUpdates.dir, missingUpdates.files),
          defaultOptions(),
        )
      ).errors,
    ).toEqual([])
  })
})
