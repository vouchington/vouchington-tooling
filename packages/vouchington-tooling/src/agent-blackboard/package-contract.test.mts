import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, unknown>
}

describe('Agent Blackboard package contract', () => {
  it('requires consumers to opt into the integration explicitly', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as PackageManifest

    expect(manifest.devDependencies?.['agent-blackboard']).toBe('^0.5.0')
    expect(manifest.dependencies?.['agent-blackboard']).toBeUndefined()
    expect(manifest.optionalDependencies?.['agent-blackboard']).toBeUndefined()
    expect(manifest.peerDependencies?.['agent-blackboard']).toBeUndefined()
    expect(manifest.peerDependenciesMeta?.['agent-blackboard']).toBeUndefined()
  })
})
