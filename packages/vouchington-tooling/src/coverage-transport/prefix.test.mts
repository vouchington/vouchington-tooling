import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseTransportControl, writeTransportControl } from './control.mts'
import { parseTransportObjectKey, transportObjectKeysV2, transportPrefix } from './keys.mts'
import { cmdUpload } from './lib.mts'
import { discoverDownloadControl } from './discovery.mts'
import { mintPrefixUploadControl } from './prefix.mts'

const identity = {
  repository: 'owner/repo',
  revision: 'a'.repeat(40),
  runId: '99',
  controlAttempt: 3,
} as const

describe('prefix coverage transport', () => {
  it('binds every object to the revision and validates exact object grammar', () => {
    expect(transportPrefix(identity)).toBe(
      `coverage-transport/owner/repo/99/${identity.revision}/attempt-3`,
    )
    const keys = transportObjectKeysV2(identity, 'web-shard-2')
    expect(parseTransportObjectKey(keys.lcov, identity)).toEqual({
      attempt: 3,
      suite: 'web-shard-2',
      kind: 'lcov',
    })
    expect(
      parseTransportObjectKey(keys.manifest.replace('coverage-manifest', '../manifest'), identity),
    ).toBeNull()
    expect(
      parseTransportObjectKey(keys.lcov.replace('/attempt-3/', '/attempt-4/'), identity),
    ).toBeNull()
  })

  it('mints a prefix-only upload capability without a producer-selected key field', async () => {
    const control = await mintPrefixUploadControl(
      identity,
      {
        signPost: async (keyPrefix, ttlSeconds, maxObjectBytes) => ({
          url: 'https://storage.example.test/upload',
          fields: { policy: `ttl-${ttlSeconds}` },
          keyPrefix,
          maxObjectBytes,
        }),
      },
      { ttlSeconds: 60, maxObjectBytes: 123, now: () => new Date('2026-01-01T00:00:00.000Z') },
    )
    expect(control.upload).toEqual({
      url: 'https://storage.example.test/upload',
      fields: { policy: 'ttl-60' },
      keyPrefix: `${transportPrefix(identity)}/`,
      maxObjectBytes: 123,
    })
    expect(parseTransportControl(control)).toEqual(control)
    expect(() =>
      parseTransportControl({
        ...control,
        upload: { ...control.upload, fields: { key: 'escape' } },
      }),
    ).toThrow(/Prefix upload/)
  })

  it('uploads a pair through POST with keys derived from the trusted prefix control', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prefix-transport-'))
    mkdirSync(join(root, 'coverage'))
    writeFileSync(join(root, 'coverage/lcov.info'), 'SF:src/a.ts\nend_of_record\n')
    writeFileSync(join(root, 'coverage/coverage-manifest.json'), '{"version":2}\n')
    const control = await mintPrefixUploadControl(identity, {
      signPost: async (keyPrefix) => ({
        url: 'https://storage.example.test/upload',
        fields: { policy: 'signed' },
        keyPrefix,
        maxObjectBytes: 1024,
      }),
    })
    const path = join(root, 'control.json')
    writeTransportControl(path, control)
    const original = globalThis.fetch
    const submitted: string[] = []
    globalThis.fetch = async (_url, init) => {
      const body = init?.body as FormData
      const key = body.get('key')
      if (typeof key !== 'string') throw new Error('Expected form key')
      submitted.push(key)
      return new Response(null, { status: 204 })
    }
    try {
      await expect(
        cmdUpload(path, 'web', {
          cwd: root,
          expectedIdentity: {
            repository: identity.repository,
            revision: identity.revision,
            runId: identity.runId,
            currentAttempt: identity.controlAttempt,
          },
        }),
      ).resolves.toEqual({ coverage: true, blob: false })
    } finally {
      globalThis.fetch = original
    }
    expect(submitted).toEqual([
      transportObjectKeysV2(identity, 'web').lcov,
      transportObjectKeysV2(identity, 'web').manifest,
    ])
  })

  it('paginates and selects the newest complete coverage pair but keeps older valid producers', async () => {
    const keys = (suite: string, attempt: number) => transportObjectKeysV2(identity, suite, attempt)
    const pages = [
      {
        objects: [
          { key: keys('web', 2).lcov, byteLength: 1 },
          { key: keys('web', 2).manifest, byteLength: 2 },
          { key: keys('native', 1).lcov, byteLength: 3 },
        ],
        continuationToken: 'next',
      },
      {
        objects: [
          { key: keys('web', 3).lcov, byteLength: 4 },
          { key: keys('native', 1).manifest, byteLength: 5 },
          { key: keys('web', 3).blob, byteLength: 6 },
        ],
      },
    ]
    const source = await mintPrefixUploadControl(identity, {
      signPost: async (keyPrefix) => ({
        url: 'https://storage.example.test/upload',
        fields: {},
        keyPrefix,
        maxObjectBytes: 32,
      }),
    })
    const signed: string[] = []
    const result = await discoverDownloadControl(
      source,
      {
        list: async (_prefix, token) => pages[token === undefined ? 0 : 1]!,
      },
      {
        signGet: async (key) => {
          signed.push(key)
          return `https://storage.example.test/${key}`
        },
      },
      { ttlSeconds: 60 },
    )
    expect(result.coverage.web?.lcov.key).toBe(keys('web', 2).lcov)
    expect(result.coverage.native?.manifest.key).toBe(keys('native', 1).manifest)
    expect(result.blobs.web?.attempt).toBe(3)
    expect(signed).not.toContain(keys('web', 3).lcov)
  })

  it.each([
    [
      'foreign key',
      [
        {
          key: 'coverage-transport/owner/repo/99/elsewhere/attempt-1/coverage/web/lcov.info',
          byteLength: 1,
        },
      ],
    ],
    [
      'duplicate key',
      (() => {
        const key = transportObjectKeysV2(identity, 'web').lcov
        return [
          { key, byteLength: 1 },
          { key, byteLength: 1 },
        ]
      })(),
    ],
  ])('rejects %s during discovery', async (_label, objects) => {
    const source = await mintPrefixUploadControl(identity, {
      signPost: async (keyPrefix) => ({
        url: 'https://storage.example.test/upload',
        fields: {},
        keyPrefix,
        maxObjectBytes: 32,
      }),
    })
    await expect(
      discoverDownloadControl(
        source,
        { list: async () => ({ objects }) },
        { signGet: async () => 'https://storage.example.test/get' },
      ),
    ).rejects.toThrow(/discovery/)
  })
})
