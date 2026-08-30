import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Record<string, unknown>

describe('package metadata', () => {
  it('keeps agent-blackboard explicit for consumers', () => {
    expect(packageJson.devDependencies).toMatchObject({ 'agent-blackboard': expect.any(String) })
    expect(packageJson.peerDependencies).toBeUndefined()
    expect(packageJson.peerDependenciesMeta).toBeUndefined()
  })
})
