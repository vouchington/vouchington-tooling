import { describe, expect, it } from 'vitest'

import { evaluatePackageLicenseExpression, evaluatePnpmLicenseReport } from './policy.mts'
import type { DependencyLicensePolicy } from './types.mts'

const policy: DependencyLicensePolicy = {
  deniedLicenseIds: ['Unknown', 'UNLICENSED', ''],
  deniedLicensePrefixes: ['GPL', 'AGPL', 'LGPL', 'MPL'],
  knownLicenseAliases: { 'PERMISSIVE LICENSE': 'MIT' },
  allowlist: [
    { licenseId: 'MPL-2.0', reason: 'reviewed for every package', scope: { kind: 'all' } },
    {
      licenseId: 'LGPL-3.0-or-later',
      reason: 'reviewed native package family',
      scope: {
        kind: 'exact',
        packageNames: ['@example/native-linux', '@example/native-darwin'],
      },
    },
  ],
}

describe('dependency license policy', () => {
  it('allows standard permissive licenses and known aliases', () => {
    for (const expression of ['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'PERMISSIVE LICENSE']) {
      expect(evaluatePackageLicenseExpression(expression, 'example', policy).ok).toBe(true)
    }
  })

  it('works without any allowlist entries', () => {
    expect(
      evaluatePackageLicenseExpression('MIT', 'example', {
        deniedLicenseIds: [],
        deniedLicensePrefixes: [],
      }).ok,
    ).toBe(true)
  })

  it('applies SPDX OR and AND semantics', () => {
    expect(evaluatePackageLicenseExpression('GPL-3.0-only OR MIT', 'example', policy).ok).toBe(true)
    expect(evaluatePackageLicenseExpression('GPL-3.0-only AND MIT', 'example', policy)).toEqual({
      ok: false,
      deniedAtoms: ['GPL-3.0-only'],
    })
  })

  it('denies configured IDs and prefixes', () => {
    for (const expression of ['Unknown', 'UNLICENSED', '', 'GPL-3.0-only', 'AGPL-3.0-only']) {
      expect(evaluatePackageLicenseExpression(expression, 'example', policy).ok).toBe(false)
    }
  })

  it('fails closed for malformed, unknown, and custom expressions', () => {
    for (const expression of [
      'Proprietary',
      'Made-Up-License',
      'LicenseRef-Proprietary',
      'MIT OR LicenseRef-Proprietary',
      '(MIT OR Apache-2.0',
    ]) {
      expect(evaluatePackageLicenseExpression(expression, 'example', policy)).toEqual({
        ok: false,
        deniedAtoms: [expression],
      })
    }
  })

  it('supports global and package-scoped allowlist entries', () => {
    expect(evaluatePackageLicenseExpression('MPL-2.0', 'any-package', policy).ok).toBe(true)
    expect(
      evaluatePackageLicenseExpression('LGPL-3.0-or-later', '@example/native-linux', policy).ok,
    ).toBe(true)
    expect(
      evaluatePackageLicenseExpression('LGPL-3.0-or-later', '@example/native-windows', policy),
    ).toEqual({ ok: false, deniedAtoms: ['LGPL-3.0-or-later'] })
  })

  it('returns typed violations for every denied report entry', () => {
    expect(
      evaluatePnpmLicenseReport(
        {
          MIT: [{ name: 'clean', versions: ['1.0.0'] }],
          'GPL-3.0-only': [{ name: 'copyleft', versions: ['2.0.0'] }, { name: 'versionless' }],
        },
        policy,
      ),
    ).toEqual([
      {
        ok: false,
        deniedAtoms: ['GPL-3.0-only'],
        licenseExpression: 'GPL-3.0-only',
        packageName: 'copyleft',
        versions: ['2.0.0'],
      },
      {
        ok: false,
        deniedAtoms: ['GPL-3.0-only'],
        licenseExpression: 'GPL-3.0-only',
        packageName: 'versionless',
      },
    ])
  })
})
