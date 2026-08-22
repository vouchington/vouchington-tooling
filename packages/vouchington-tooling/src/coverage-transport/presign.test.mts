import { describe, expect, it } from 'vitest'

import { mintPresignedControl, transportObjectKeys } from './presign.mts'

describe('coverage transport S3 keys', () => {
  it('binds coverage and blob objects to the run and control attempt', () => {
    expect(transportObjectKeys('12345', 3, 'web-shard-2')).toEqual({
      lcov: 'coverage-transport/12345/3/coverage/web-shard-2/lcov.info',
      manifest: 'coverage-transport/12345/3/coverage/web-shard-2/coverage-manifest.json',
      blob: 'coverage-transport/12345/3/blobs/web-shard-2.tar.gz',
    })
  })

  it('uses an injected manifest filename', () => {
    expect(transportObjectKeys('12345', 1, 'web', 'manifest.json').manifest).toBe(
      'coverage-transport/12345/1/coverage/web/manifest.json',
    )
  })

  it.each([
    ['0', 1, 'web'],
    ['1', 0, 'web'],
    ['1', 1, '../web'],
  ])('rejects unsafe key identity %#', (runId, attempt, suite) => {
    expect(() => transportObjectKeys(runId, attempt, suite)).toThrowError(
      'Coverage transport key identity is invalid',
    )
  })
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
        signPut: async (key) => {
          signed.push(`put:${key}`)
          return `https://example.test/put/${key}`
        },
        signGet: async (key) => {
          signed.push(`get:${key}`)
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
      'https://example.test/put/coverage-transport/99/2/coverage/web/lcov.info',
    )
    expect(control.blobs.schema?.get).toBe(
      'https://example.test/get/coverage-transport/99/2/blobs/schema.tar.gz',
    )
    expect(signed.filter((entry) => entry.includes('/blobs/schema.tar.gz'))).toEqual([
      'put:coverage-transport/99/2/blobs/schema.tar.gz',
      'get:coverage-transport/99/2/blobs/schema.tar.gz',
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
