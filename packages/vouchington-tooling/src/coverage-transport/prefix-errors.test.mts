import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseTransportControl } from './control.mts'
import { DEFAULT_MAX_BODY_BYTES } from './constants.mts'
import { discoverDownloadControl } from './discovery.mts'
import {
  assertPrefixTransportIdentity,
  parseTransportObjectKey,
  transportObjectKeysV2,
  transportPrefix,
} from './keys.mts'
import {
  downloadPrefixBlobs,
  downloadPrefixCoverage,
  uploadPrefixTransport,
} from './prefix-transfer.mts'
import { mintPrefixUploadControl, transportExpiresAt } from './prefix.mts'

const identity = {
  repository: 'owner/repo',
  revision: 'a'.repeat(40),
  runId: '99',
  controlAttempt: 3,
} as const

async function upload() {
  return mintPrefixUploadControl(identity, {
    signPost: async (keyPrefix) => ({
      url: 'https://storage.example.test/upload',
      fields: {},
      keyPrefix,
      maxObjectBytes: 1024,
    }),
  })
}

function download() {
  const keys = transportObjectKeysV2(identity, 'web')
  return {
    version: 2 as const,
    mode: 'discovered-download' as const,
    repository: identity.repository,
    revision: identity.revision,
    run: { id: identity.runId, controlAttempt: identity.controlAttempt },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    coverage: {
      web: {
        lcov: {
          key: keys.lcov,
          url: 'https://storage.example.test/lcov',
          attempt: 3,
          byteLength: 1,
        },
        manifest: {
          key: keys.manifest,
          url: 'https://storage.example.test/manifest',
          attempt: 3,
          byteLength: 1,
        },
      },
    },
    blobs: {},
  }
}

describe('prefix transport error boundaries', () => {
  it.each([
    [{ ...identity, repository: 'owner/../repo' }],
    [{ ...identity, revision: 'invalid' }],
    [{ ...identity, runId: '0' }],
    [{ ...identity, controlAttempt: 0 }],
  ])('rejects invalid key identities', (value) => {
    expect(() => assertPrefixTransportIdentity(value)).toThrow(/identity/)
  })

  it('rejects invalid attempts, suites, sizes, and TTLs', async () => {
    expect(() => transportPrefix(identity, 0)).toThrow(/attempt/)
    expect(() => transportPrefix(identity, 4)).toThrow(/attempt/)
    expect(() => transportObjectKeysV2(identity, '../web')).toThrow(/suite/)
    expect(
      parseTransportObjectKey(`${transportPrefix(identity)}/not-an-object`, identity),
    ).toBeNull()
    expect(() => transportExpiresAt({ ttlSeconds: 0 })).toThrow(/TTL/)
    await expect(
      mintPrefixUploadControl(identity, {
        signPost: async () => ({
          url: 'https://x',
          fields: {},
          keyPrefix: 'wrong',
          maxObjectBytes: 1,
        }),
      }),
    ).rejects.toThrow(/Prefix upload/)
    await expect(
      mintPrefixUploadControl(
        identity,
        {
          signPost: async () => ({
            url: 'https://x',
            fields: {},
            keyPrefix: `${transportPrefix(identity)}/`,
            maxObjectBytes: 1,
          }),
        },
        { maxObjectBytes: DEFAULT_MAX_BODY_BYTES + 1 },
      ),
    ).rejects.toThrow(/size limit/)
    await expect(
      mintPrefixUploadControl(
        identity,
        {
          signPost: async (keyPrefix) => ({
            url: 'https://x',
            fields: {},
            keyPrefix,
            maxObjectBytes: 2,
          }),
        },
        { maxObjectBytes: 1 },
      ),
    ).rejects.toThrow(/signer size/)
  })

  it.each([
    (control: ReturnType<typeof download>) => ({ ...control, run: {} }),
    (control: ReturnType<typeof download>) => ({ ...control, repository: 1 }),
    (control: ReturnType<typeof download>) => ({ ...control, repository: 'bad/repo/extra' }),
    (control: ReturnType<typeof download>) => ({
      ...control,
      coverage: { 'bad suite': control.coverage.web },
    }),
    (control: ReturnType<typeof download>) => ({
      ...control,
      coverage: { web: { lcov: control.coverage.web.lcov } },
    }),
    (control: ReturnType<typeof download>) => ({
      ...control,
      coverage: {
        web: { ...control.coverage.web, lcov: { ...control.coverage.web.lcov, key: 'bad' } },
      },
    }),
    (control: ReturnType<typeof download>) => ({
      ...control,
      coverage: {
        web: { ...control.coverage.web, lcov: { ...control.coverage.web.lcov, byteLength: -1 } },
      },
    }),
    (control: ReturnType<typeof download>) => ({ ...control, mode: 'wrong' }),
  ])('rejects malformed v2 control input', (mutate) => {
    expect(() => parseTransportControl(mutate(download()))).toThrow()
  })

  it('rejects a coverage pair whose individually valid objects use different attempts', () => {
    const older = transportObjectKeysV2(identity, 'web', 2)
    expect(() =>
      parseTransportControl({
        ...download(),
        coverage: {
          web: {
            lcov: { ...download().coverage.web.lcov, key: older.lcov, attempt: 2 },
            manifest: download().coverage.web.manifest,
          },
        },
      }),
    ).toThrow(/attempts do not match/)
  })

  it('selects a matching object after another kind and signs it with the default TTL', async () => {
    const keys = transportObjectKeysV2(identity, 'web')
    const signed: number[] = []
    await discoverDownloadControl(
      await upload(),
      {
        list: async () => ({
          objects: [
            { key: keys.manifest, byteLength: 1 },
            { key: keys.lcov, byteLength: 1 },
          ],
        }),
      },
      { signGet: async (_key, ttl) => (signed.push(ttl), 'https://storage.example.test/get') },
    )
    expect(signed).toHaveLength(2)
  })

  it.each([
    async () => ({
      objects: Array.from({ length: 1025 }, (_, index) => ({ key: `bad-${index}`, byteLength: 1 })),
    }),
    async () => ({
      objects: [{ key: transportObjectKeysV2(identity, 'web').lcov, byteLength: -1 }],
    }),
    async () => ({
      objects: [
        { key: transportObjectKeysV2(identity, 'web').lcov, byteLength: 1 },
        { key: transportObjectKeysV2(identity, 'web').lcov, byteLength: 1 },
      ],
    }),
    async () => ({
      objects: [
        {
          key: 'coverage-transport/owner/repo/99/bad/attempt-1/coverage/web/lcov.info',
          byteLength: 1,
        },
      ],
    }),
  ])('rejects invalid discovery pages', async (list) => {
    await expect(
      discoverDownloadControl(await upload(), { list }, { signGet: async () => 'https://x' }),
    ).rejects.toThrow(/discovery/)
  })

  it('rejects cyclic pagination', async () => {
    await expect(
      discoverDownloadControl(
        await upload(),
        { list: async () => ({ objects: [], continuationToken: 'again' }) },
        { signGet: async () => 'https://x' },
      ),
    ).rejects.toThrow(/cyclic/)
  })

  it('rejects non-string discovery continuation tokens', async () => {
    await expect(
      discoverDownloadControl(
        await upload(),
        { list: async () => ({ objects: [], continuationToken: 1 as unknown as string }) },
        { signGet: async () => 'https://x' },
      ),
    ).rejects.toThrow(/continuation/)
  })

  it('rejects non-object discovered maps and selects no pair from a lone lcov object', async () => {
    expect(() => parseTransportControl({ ...download(), coverage: null })).toThrow(/map/)
    await expect(
      discoverDownloadControl(
        await upload(),
        {
          list: async () => ({
            objects: [{ key: transportObjectKeysV2(identity, 'web').lcov, byteLength: 1 }],
          }),
        },
        { signGet: async () => 'https://x' },
      ),
    ).resolves.toMatchObject({ coverage: {} })
  })

  it('rejects unsupported filenames and handles incomplete remote pairs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prefix-errors-'))
    const control = download()
    await expect(downloadPrefixCoverage(control, root, 'other.json', {})).rejects.toThrow(/default/)
    await expect(
      uploadPrefixTransport(
        await upload(),
        'web',
        root,
        {
          repository: identity.repository,
          revision: identity.revision,
          runId: identity.runId,
          currentAttempt: 3,
        },
        'other.json',
        {},
      ),
    ).rejects.toThrow(/default/)
    const original = globalThis.fetch
    globalThis.fetch = async () => new Response(null, { status: 404 })
    try {
      await expect(
        downloadPrefixCoverage(control, root, 'coverage-manifest.json', {}),
      ).resolves.toBeUndefined()
    } finally {
      globalThis.fetch = original
    }
  })

  it('reports pair and blob POST failures without treating either as persisted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prefix-failures-'))
    mkdirSync(join(root, 'coverage'))
    mkdirSync(join(root, '.vitest-reports'))
    writeFileSync(join(root, 'coverage/lcov.info'), 'SF:a\nend_of_record\n')
    writeFileSync(join(root, 'coverage/coverage-manifest.json'), '{}')
    writeFileSync(join(root, '.vitest-reports/web.json'), '{}')
    const original = globalThis.fetch
    globalThis.fetch = async () => new Response(null, { status: 500 })
    try {
      await expect(
        uploadPrefixTransport(
          await upload(),
          'web',
          root,
          {
            repository: identity.repository,
            revision: identity.revision,
            runId: identity.runId,
            currentAttempt: 3,
          },
          'coverage-manifest.json',
          { retryDelayMs: 0 },
        ),
      ).resolves.toEqual({ coverage: false, blob: false })
    } finally {
      globalThis.fetch = original
    }
  })

  it('rejects an upload control from a different attempt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prefix-attempt-'))
    await expect(
      uploadPrefixTransport(
        await upload(),
        'web',
        root,
        {
          repository: identity.repository,
          revision: identity.revision,
          runId: identity.runId,
          currentAttempt: 2,
        },
        'coverage-manifest.json',
        {},
      ),
    ).rejects.toThrow(/attempt/)
  })

  it('returns an unpersisted outcome when local coverage files are absent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prefix-missing-'))
    await expect(
      uploadPrefixTransport(
        await upload(),
        'web',
        root,
        {
          repository: identity.repository,
          revision: identity.revision,
          runId: identity.runId,
          currentAttempt: 3,
        },
        'coverage-manifest.json',
        {},
      ),
    ).resolves.toEqual({ coverage: false, blob: false })
  })

  it('maps discovered blobs to their exact GET URL', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prefix-blobs-'))
    const control = {
      ...download(),
      blobs: {
        web: {
          key: transportObjectKeysV2(identity, 'web').blob,
          url: 'https://storage.example.test/blob',
          attempt: 3,
          byteLength: 1,
        },
      },
    }
    const original = globalThis.fetch
    globalThis.fetch = async () => new Response(null, { status: 404 })
    try {
      await expect(downloadPrefixBlobs(control, root, {})).resolves.toBeUndefined()
    } finally {
      globalThis.fetch = original
    }
  })
})
