import { describe, expect, it } from 'vitest'

import {
  flattenReleaseAgeSelectors,
  packageNameFromPnpmLockKey,
  pnpmLockPackageKeyMatchesSelector,
  validateReleaseAgeExemptionGroups,
  validateReleaseAgePolicy,
  type ReleaseAgeExemptionGroup,
} from './release-age-policy.mts'

const temporary: ReleaseAgeExemptionGroup = {
  selectors: ['demo-package@1.2.3'],
  reason: 'Temporary toolchain unblock.',
  eligibleForRemovalAt: '2026-07-17T09:24:27Z',
}

describe('release-age exemption groups', () => {
  it('accepts grouped exact selectors and flattens them', () => {
    const groups = [{ ...temporary, selectors: ['demo-package@1.2.3', 'other@2.0.0'] as const }]
    expect(validateReleaseAgeExemptionGroups(groups)).toEqual([])
    expect(flattenReleaseAgeSelectors(groups)).toEqual(['demo-package@1.2.3', 'other@2.0.0'])
  })

  it('rejects duplicate, ranged, blank, and noncanonical entries', () => {
    expect(
      validateReleaseAgeExemptionGroups([
        temporary,
        { ...temporary },
        {
          ...temporary,
          selectors: ['demo-package@^1.2.3'],
          reason: ' ',
          eligibleForRemovalAt: '2026-07-17T09:24:27.000Z',
        },
      ]),
    ).toEqual([
      expect.stringContaining('duplicate release-age exemption'),
      expect.stringContaining('exact package@version selector'),
      expect.stringContaining('nonblank reason'),
      expect.stringContaining('canonical UTC instant'),
    ])
  })

  it('rejects impossible calendar dates even when the timestamp shape is canonical', () => {
    expect(
      validateReleaseAgeExemptionGroups([
        { ...temporary, eligibleForRemovalAt: '2026-02-30T09:24:27Z' },
      ]),
    ).toEqual([expect.stringContaining('canonical UTC instant')])
  })

  it('requires each exemption group to name at least one selector', () => {
    expect(
      validateReleaseAgeExemptionGroups([
        {
          ...temporary,
          selectors: [] as unknown as ReleaseAgeExemptionGroup['selectors'],
        },
      ]),
    ).toEqual(['release-age exemption group must contain at least one exact selector'])
  })
})

describe('pnpm lockfile selectors', () => {
  it.each([
    ['/demo-package@1.2.3', 'demo-package'],
    ['/@scope/demo-package@1.2.3(peer@1.0.0)', '@scope/demo-package'],
    ['demo-package@1.2.3', 'demo-package'],
  ])('extracts %s as %s', (key, name) => {
    expect(packageNameFromPnpmLockKey(key)).toBe(name)
  })

  it.each(['@scope', '@scope/package', 'package', '/@scope'])(
    'rejects malformed lockfile keys %s',
    (key) => {
      expect(packageNameFromPnpmLockKey(key)).toBeNull()
    },
  )

  it('matches peer and patched lockfile keys but not a different version', () => {
    expect(pnpmLockPackageKeyMatchesSelector('/demo-package@1.2.3', 'demo-package@1.2.3')).toBe(
      true,
    )
    expect(
      pnpmLockPackageKeyMatchesSelector('/demo-package@1.2.3(peer@1.0.0)', 'demo-package@1.2.3'),
    ).toBe(true)
    expect(
      pnpmLockPackageKeyMatchesSelector('/demo-package@1.2.3_patched', 'demo-package@1.2.3'),
    ).toBe(true)
    expect(pnpmLockPackageKeyMatchesSelector('/demo-package@1.2.4', 'demo-package@1.2.3')).toBe(
      false,
    )
    expect(pnpmLockPackageKeyMatchesSelector('demo-package@1.2.3', 'demo-package@1.2.3')).toBe(true)
  })
})

describe('release-age policy', () => {
  const config = {
    permanentExemptions: [{ name: '@acme/internal-tool', reason: 'First-party package.' }],
    temporaryExemptionGroups: [temporary],
    firstPartyPackagePrefixes: ['@acme/'],
  } as const

  it('accepts an empty policy snapshot without optional configuration', () => {
    expect(validateReleaseAgePolicy({}, { workspaceExcludes: [] })).toEqual([])
  })

  it('accepts a consistent workspace, active graph, and lockfile snapshot', () => {
    expect(
      validateReleaseAgePolicy(config, {
        workspaceExcludes: ['@acme/internal-tool', 'demo-package@1.2.3'],
        activePackageNames: ['@acme/internal-tool', 'demo-package'],
        lockfilePackageKeys: ['/@acme/internal-tool@1.0.0', '/demo-package@1.2.3(peer@1.0.0)'],
      }),
    ).toEqual([])
  })

  it('reports unknown and missing workspace entries, graph drift, and lockfile orphans', () => {
    const errors = validateReleaseAgePolicy(config, {
      workspaceExcludes: ['unknown@1.0.0', 'unknown@1.0.0'],
      activePackageNames: ['@acme/new-tool'],
      lockfilePackageKeys: [],
    })
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('contains unregistered entry "unknown@1.0.0"'),
        expect.stringContaining('duplicates "unknown@1.0.0"'),
        expect.stringContaining('registered release-age exemption "@acme/internal-tool"'),
        expect.stringContaining('active first-party package "@acme/new-tool"'),
        expect.stringContaining('absent from lockfile packages'),
      ]),
    )
  })

  it('allows a registry package to be inactive when explicitly configured', () => {
    expect(
      validateReleaseAgePolicy(
        { ...config, requirePermanentExemptionsActive: false },
        {
          workspaceExcludes: ['@acme/internal-tool', 'demo-package@1.2.3'],
          activePackageNames: [],
          lockfilePackageKeys: ['/demo-package@1.2.3'],
        },
      ),
    ).toEqual([])
  })

  it('reports malformed permanent entries and non-string workspace exclusions', () => {
    expect(
      validateReleaseAgePolicy(
        {
          permanentExemptions: [
            { name: ' ', reason: ' ' },
            { name: ' ', reason: 'Duplicate blank name.' },
          ],
        },
        { workspaceExcludes: [null, 42, ' '] },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('permanent release-age exemption name must be nonblank'),
        expect.stringContaining('duplicate permanent release-age exemption " "'),
        expect.stringContaining('permanent release-age exemption " " must have a nonblank reason'),
        expect.stringContaining('minimumReleaseAgeExclude entry null must be a string'),
        expect.stringContaining('minimumReleaseAgeExclude entry 42 must be a string'),
      ]),
    )
  })
})
