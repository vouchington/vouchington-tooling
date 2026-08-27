import { describe, expect, it } from 'vitest'
import {
  bundleDigest,
  parseRepositoryPathFetchConfig,
  validateDestination,
  type RepositoryPathFetchConfig,
  type RepositoryPathMapping,
} from './index.mts'

describe('repository-path-fetch exports', () => {
  it('exports the config parser and mapping type', () => {
    const mapping: RepositoryPathMapping = { destination: 'target', source: 'source' }
    expect(
      parseRepositoryPathFetchConfig({
        paths: [mapping],
        ref: 'main',
        repository: 'owner/repository',
        schemaVersion: 1,
      }),
    ).toMatchObject({ schemaVersion: 1 })
    const config: RepositoryPathFetchConfig = {
      paths: [mapping],
      ref: 'main',
      repository: 'owner/repository',
      schemaVersion: 1,
    }
    expect(bundleDigest).toBeTypeOf('function')
    expect(() => validateDestination('/private/tmp/contracts')).not.toThrow()
    expect(config.schemaVersion).toBe(1)
  })
})
