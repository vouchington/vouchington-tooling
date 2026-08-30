import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

interface PackageManifest {
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest

describe('package metadata', () => {
  it('keeps agent-blackboard explicit for consumers', () => {
    expect(packageJson.devDependencies?.['agent-blackboard']).toEqual(expect.any(String))
    expect(packageJson.peerDependencies?.['agent-blackboard']).toBeUndefined()
    expect(packageJson.peerDependenciesMeta?.['agent-blackboard']).toBeUndefined()
  })
})
