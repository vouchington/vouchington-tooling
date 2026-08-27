import { describe, expect, it } from 'vitest'
import {
  parseRepositoryPathFetchConfig,
  validateDestination,
  validateRelativePath,
} from './validation.mts'

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
    ['owner/repository', 'branch//nested', 'api'],
    ['owner/repository', 'branch.', 'api'],
    ['owner/repository', 'branch.lock', 'api'],
    ['owner/repository', 'branch/nested.lock', 'api'],
    ['owner/repository', 'branch/.hidden', 'api'],
    ['owner/repository', 'branch%name', 'api'],
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

  it.each([
    null,
    [],
    { repository: 'owner/repository', ref: 'main', paths: [], schemaVersion: 2 },
    { repository: 'owner/repository', ref: 'main', paths: [], schemaVersion: 1 },
    { repository: 'owner/repository', ref: 'main', paths: [null], schemaVersion: 1 },
    {
      repository: 'owner/repository',
      ref: 'main',
      paths: [
        { destination: 'same', source: 'one' },
        { destination: 'same', source: 'two' },
      ],
      schemaVersion: 1,
    },
    {
      repository: 'owner/repository',
      ref: 'main',
      paths: [
        { destination: 'Swift', source: 'one' },
        { destination: 'swift', source: 'two' },
      ],
      schemaVersion: 1,
    },
    {
      repository: 'owner/repository',
      ref: 'main',
      paths: [
        { destination: 'Cafe\u0301', source: 'one' },
        { destination: 'Café', source: 'two' },
      ],
      schemaVersion: 1,
    },
    {
      repository: 'owner/repository',
      ref: 'main',
      paths: [
        { destination: 'parent', source: 'one' },
        { destination: 'parent/child', source: 'two' },
      ],
      schemaVersion: 1,
    },
  ])('rejects malformed config %#', (config) => {
    expect(() => parseRepositoryPathFetchConfig(config)).toThrow()
  })

  it.each(['relative', '/', '/tmp/../tmp/output', '/tmp/output/'])(
    'rejects unsafe output %s',
    (path) => {
      expect(() => validateDestination(path)).toThrow('normalized non-root absolute path')
    },
  )

  it.each(['.', '-flag', 'a\\b', 'a/../b'])('rejects unsafe relative path %s', (path) => {
    expect(() => validateRelativePath(path)).toThrow('unsafe path')
  })
})
