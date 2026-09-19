import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import * as dependencyLicensePolicy from './index.mts'

describe('dependency-license-policy subpath', () => {
  it('publishes the built subpath contract', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, unknown> }
    expect(manifest.exports['./dependency-license-policy']).toEqual({
      default: './dist/dependency-license-policy/index.mjs',
      import: './dist/dependency-license-policy/index.mjs',
      types: './dist/dependency-license-policy/index.d.mts',
    })
  })

  it('re-exports only the high-level collection and policy surface', () => {
    expect(Object.keys(dependencyLicensePolicy).toSorted()).toEqual([
      'collectPnpmLicenseReport',
      'evaluatePackageLicenseExpression',
      'evaluatePnpmLicenseReport',
      'parsePnpmLicenseReport',
    ])
  })
})
