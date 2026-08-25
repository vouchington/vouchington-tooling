import { VITEST_SUITE_PATTERN } from '../vitest-blob-manifest/index.mts'

export interface PrefixTransportIdentity {
  readonly repository: string
  readonly revision: string
  readonly runId: string
  readonly controlAttempt: number
}

export type TransportObjectKind = 'lcov' | 'manifest' | 'blob'

export interface TransportObjectKey {
  readonly attempt: number
  readonly suite: string
  readonly kind: TransportObjectKind
}

export function assertPrefixTransportIdentity(identity: PrefixTransportIdentity): void {
  if (
    identity.repository.includes('..') ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(identity.repository) ||
    !/^[0-9a-f]{40}$/.test(identity.revision) ||
    !/^[1-9][0-9]*$/.test(identity.runId) ||
    !Number.isSafeInteger(identity.controlAttempt) ||
    identity.controlAttempt < 1
  ) {
    throw new Error('Coverage transport key identity is invalid')
  }
}

export function transportPrefix(
  identity: PrefixTransportIdentity,
  attempt = identity.controlAttempt,
): string {
  assertPrefixTransportIdentity(identity)
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > identity.controlAttempt) {
    throw new Error('Coverage transport attempt is invalid')
  }
  return `coverage-transport/${identity.repository}/${identity.runId}/${identity.revision}/attempt-${attempt}`
}

export function transportObjectKeysV2(
  identity: PrefixTransportIdentity,
  suite: string,
  attempt = identity.controlAttempt,
): Readonly<Record<TransportObjectKind, string>> {
  if (!VITEST_SUITE_PATTERN.test(suite)) throw new Error('Coverage transport suite is invalid')
  const prefix = transportPrefix(identity, attempt)
  return {
    lcov: `${prefix}/coverage/${suite}/lcov.info`,
    manifest: `${prefix}/coverage/${suite}/coverage-manifest.json`,
    blob: `${prefix}/blobs/${suite}.tar.gz`,
  }
}

export function parseTransportObjectKey(
  key: string,
  identity: PrefixTransportIdentity,
): TransportObjectKey | null {
  const root = `coverage-transport/${identity.repository}/${identity.runId}/${identity.revision}/`
  if (!key.startsWith(root) || key.includes('..') || key.includes('\\')) return null
  const match =
    /^attempt-([1-9][0-9]*)\/(?:coverage\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(lcov\.info|coverage-manifest\.json)|blobs\/([a-z0-9]+(?:-[a-z0-9]+)*)\.tar\.gz)$/.exec(
      key.slice(root.length),
    )
  if (!match) return null
  const attempt = Number(match[1])
  if (!Number.isSafeInteger(attempt) || attempt > identity.controlAttempt) return null
  const coverageSuite = match[2]
  if (coverageSuite) {
    return { attempt, suite: coverageSuite, kind: match[3] === 'lcov.info' ? 'lcov' : 'manifest' }
  }
  const blobSuite = match[4]
  if (!blobSuite) return null
  return { attempt, suite: blobSuite, kind: 'blob' }
}
