import { describe, expect, it } from 'vitest'
import { parseRepositoryPathFetchConfig } from './validation.mts'

describe('parseRepositoryPathFetch', () => {
  it('accepts a repository, ref, absolute destination, and distinct relative paths', () => {
    expect(
      parseRepositoryPathFetchConfig({
        paths: [
          { destination: 'api/v1', source: 'api/v1' },
          { destination: 'localization/swift', source: 'localization/swift' },
        ],
        ref: 'main',
        repository: 'owner/repository',
        schemaVersion: 1,
      }),
    ).toEqual({
      paths: [
        { destination: 'api/v1', source: 'api/v1' },
        { destination: 'localization/swift', source: 'localization/swift' },
      ],
      ref: 'main',
      repository: 'owner/repository',
      schemaVersion: 1,
    })
  })

  it.each([
    ['owner/repository/extra', 'main', 'api'],
    ['owner/repository', '../main', 'api'],
    ['owner/repository', 'main', '../api'],
    ['owner/repository', 'main', '/api'],
  ])('rejects unsafe input %s %s %s', (repository, ref, path) => {
    expect(() =>
      parseRepositoryPathFetchConfig({
        paths: [{ destination: path, source: path }],
        ref,
        repository,
        schemaVersion: 1,
      }),
    ).toThrow()
  })
})
