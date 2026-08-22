import { describe, expect, it } from 'vitest'

import { mintPresignedControl, transportObjectKeys } from './presign.mts'

describe('coverage transport S3 keys', () => {
  it('binds coverage and blob objects to the run and control attempt', () => {
    expect(transportObjectKeys('owner/repo', '12345', 3, 'web-shard-2')).toEqual({
      lcov: 'coverage-transport/owner/repo/12345/3/coverage/web-shard-2/lcov.info',
      manifest: 'coverage-transport/owner/repo/12345/3/coverage/web-shard-2/coverage-manifest.json',
      blob: 'coverage-transport/owner/repo/12345/3/blobs/web-shard-2.tar.gz',
    })
  })

  it('uses an injected manifest filename', () => {
    expect(transportObjectKeys('owner/repo', '12345', 1, 'web', 'manifest.json').manifest).toBe(
      'coverage-transport/owner/repo/12345/1/coverage/web/manifest.json',
    )
  })

  it.each(['../../outside.json', 'sub/dir.json', '', '.', '..', 'manifest'])(
    'rejects unsafe manifest filenames %#',
    (filename) => {
      expect(() => transportObjectKeys('owner/repo', '12345', 1, 'web', filename)).toThrowError(
        'Coverage manifest filename is invalid',
      )
    },
  )

  it.each([
    ['0', 1, 'web'],
    ['1', 0, 'web'],
    ['1', 1, '../web'],
  ])('rejects unsafe key identity %#', (runId, attempt, suite) => {
    expect(() => transportObjectKeys('owner/repo', runId, attempt, suite)).toThrowError(
      'Coverage transport key identity is invalid',
    )
  })

  it.each(['../outside', 'owner', 'owner/repo/extra'])(
    'rejects a repository that is not owner/name %#',
    (repository) => {
      expect(() => transportObjectKeys(repository, '1', 1, 'web')).toThrowError(
        'Coverage transport key identity is invalid',
      )
    },
  )
})

describe('mintPresignedControl', () => {
  it('mints put/get URLs from the injected signer and suite lists', async () => {
    const signed: string[] = []
    const control = await mintPresignedControl(
      {
        repository: 'owner/repo',
        revision: 'a'.repeat(40),
        runId: '99',
        controlAttempt: 2,
      },
      ['web'],
      ['web', 'schema'],
      {
        signPut: async (key, ttlSeconds) => {
          signed.push(`put:${ttlSeconds}:${key}`)
          return `https://example.test/put/${key}`
        },
        signGet: async (key, ttlSeconds) => {
          signed.push(`get:${ttlSeconds}:${key}`)
          return `https://example.test/get/${key}`
        },
      },
      { ttlSeconds: 60, now: () => new Date('2026-01-01T00:00:00.000Z') },
    )

    expect(control).toMatchObject({
      version: 1,
      mode: 'presigned',
      repository: 'owner/repo',
      run: { id: '99', controlAttempt: 2 },
      expiresAt: '2026-01-01T00:01:00.000Z',
    })
    expect(control.coverage.web?.lcovPut).toBe(
      'https://example.test/put/coverage-transport/owner/repo/99/2/coverage/web/lcov.info',
    )
    expect(control.blobs.schema?.get).toBe(
      'https://example.test/get/coverage-transport/owner/repo/99/2/blobs/schema.tar.gz',
    )
    expect(signed.filter((entry) => entry.includes('/blobs/schema.tar.gz'))).toEqual([
      'put:60:coverage-transport/owner/repo/99/2/blobs/schema.tar.gz',
      'get:60:coverage-transport/owner/repo/99/2/blobs/schema.tar.gz',
    ])
  })

  it('defaults the expiry clock when now is omitted', async () => {
    const before = Date.now()
    const control = await mintPresignedControl(
      {
        repository: 'owner/repo',
        revision: 'b'.repeat(40),
        runId: '1',
        controlAttempt: 1,
      },
      [],
      [],
      { signPut: async (key) => key, signGet: async (key) => key },
    )
    expect(Date.parse(control.expiresAt)).toBeGreaterThanOrEqual(before)
  })
})
