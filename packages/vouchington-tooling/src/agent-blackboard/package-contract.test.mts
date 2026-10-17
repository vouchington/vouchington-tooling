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
  it('ships agent-blackboard as a runtime dependency', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as PackageManifest

    expect(manifest.dependencies).toHaveProperty('agent-blackboard')
    expect(manifest.devDependencies?.['agent-blackboard']).toBeUndefined()
    expect(manifest.optionalDependencies?.['agent-blackboard']).toBeUndefined()
    expect(manifest.peerDependencies?.['agent-blackboard']).toBeUndefined()
    expect(manifest.peerDependenciesMeta?.['agent-blackboard']).toBeUndefined()
  })
})
