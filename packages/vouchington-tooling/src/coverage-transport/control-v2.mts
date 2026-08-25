import { VITEST_SUITE_PATTERN } from '../vitest-blob-manifest/index.mts'

import { DEFAULT_MAX_BODY_BYTES } from './constants.mts'
import {
  assertPrefixTransportIdentity,
  parseTransportObjectKey,
  transportPrefix,
  type PrefixTransportIdentity,
} from './keys.mts'

export interface PrefixPostTarget {
  readonly url: string
  readonly fields: Readonly<Record<string, string>>
  readonly keyPrefix: string
  readonly maxObjectBytes: number
}

export interface PrefixUploadTransportControl {
  readonly version: 2
  readonly mode: 'prefix-upload'
  readonly repository: string
  readonly revision: string
  readonly run: { readonly id: string; readonly controlAttempt: number }
  readonly expiresAt: string
  readonly upload: PrefixPostTarget
}

export interface DownloadedTransportObject {
  readonly key: string
  readonly url: string
  readonly attempt: number
  readonly byteLength: number
}

export interface DiscoveredDownloadTransportControl {
  readonly version: 2
  readonly mode: 'discovered-download'
  readonly repository: string
  readonly revision: string
  readonly run: { readonly id: string; readonly controlAttempt: number }
  readonly expiresAt: string
  readonly coverage: Readonly<
    Record<
      string,
      { readonly lcov: DownloadedTransportObject; readonly manifest: DownloadedTransportObject }
    >
  >
  readonly blobs: Readonly<Record<string, DownloadedTransportObject>>
}

export type TransportControlV2 = PrefixUploadTransportControl | DiscoveredDownloadTransportControl

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).toSorted().join('\0') === keys.toSorted().join('\0')
}

function validUrl(value: unknown): value is string {
  return typeof value === 'string' && URL.canParse(value) && /^https?:/i.test(value)
}

function identity(raw: Record<string, unknown>): PrefixTransportIdentity | null {
  if (!isRecord(raw.run) || !exactKeys(raw.run, ['id', 'controlAttempt'])) return null
  if (
    typeof raw.repository !== 'string' ||
    typeof raw.revision !== 'string' ||
    typeof raw.run.id !== 'string' ||
    typeof raw.run.controlAttempt !== 'number'
  )
    return null
  const result = {
    repository: raw.repository,
    revision: raw.revision,
    runId: raw.run.id,
    controlAttempt: raw.run.controlAttempt,
  }
  try {
    assertPrefixTransportIdentity(result)
  } catch {
    return null
  }
  return result
}

function parseObject(
  raw: unknown,
  expected: PrefixTransportIdentity,
  suite: string,
  kind: 'lcov' | 'manifest' | 'blob',
): DownloadedTransportObject {
  if (
    !isRecord(raw) ||
    !exactKeys(raw, ['attempt', 'byteLength', 'key', 'url']) ||
    !validUrl(raw.url) ||
    typeof raw.key !== 'string' ||
    typeof raw.attempt !== 'number' ||
    typeof raw.byteLength !== 'number' ||
    !Number.isSafeInteger(raw.attempt) ||
    !Number.isSafeInteger(raw.byteLength) ||
    raw.byteLength < 0 ||
    raw.byteLength > DEFAULT_MAX_BODY_BYTES
  )
    throw new Error('Discovered transport object is invalid')
  const parsed = parseTransportObjectKey(raw.key, expected)
  if (!parsed || parsed.suite !== suite || parsed.kind !== kind || parsed.attempt !== raw.attempt)
    throw new Error('Discovered transport object key is invalid')
  return raw as unknown as DownloadedTransportObject
}

function parseDownloadMap(
  raw: unknown,
  expected: PrefixTransportIdentity,
  kind: 'coverage' | 'blob',
): Readonly<Record<string, unknown>> {
  if (!isRecord(raw)) throw new Error('Discovered transport object map is invalid')
  for (const [suite, value] of Object.entries(raw)) {
    if (!VITEST_SUITE_PATTERN.test(suite)) throw new Error('Discovered transport suite is invalid')
    if (kind === 'blob') parseObject(value, expected, suite, 'blob')
    else if (!isRecord(value) || !exactKeys(value, ['lcov', 'manifest']))
      throw new Error('Discovered coverage pair is invalid')
    else {
      const lcov = parseObject(value.lcov, expected, suite, 'lcov')
      const manifest = parseObject(value.manifest, expected, suite, 'manifest')
      if (lcov.attempt !== manifest.attempt)
        throw new Error('Discovered coverage pair attempts do not match')
    }
  }
  return raw
}

export function parseTransportControlV2(raw: Record<string, unknown>): TransportControlV2 {
  const expected = identity(raw)
  if (
    !expected ||
    raw.version !== 2 ||
    typeof raw.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.expiresAt))
  )
    throw new Error('Coverage transport control has invalid identity fields')
  if (raw.mode === 'prefix-upload') {
    if (
      !exactKeys(raw, [
        'expiresAt',
        'mode',
        'repository',
        'revision',
        'run',
        'upload',
        'version',
      ]) ||
      !isRecord(raw.upload) ||
      !exactKeys(raw.upload, ['fields', 'keyPrefix', 'maxObjectBytes', 'url']) ||
      !validUrl(raw.upload.url) ||
      typeof raw.upload.keyPrefix !== 'string' ||
      raw.upload.keyPrefix !== `${transportPrefix(expected)}/` ||
      typeof raw.upload.maxObjectBytes !== 'number' ||
      !Number.isSafeInteger(raw.upload.maxObjectBytes) ||
      raw.upload.maxObjectBytes < 1 ||
      raw.upload.maxObjectBytes > DEFAULT_MAX_BODY_BYTES ||
      !isRecord(raw.upload.fields) ||
      Object.entries(raw.upload.fields).some(
        ([key, value]) => key === 'key' || !key || typeof value !== 'string',
      )
    )
      throw new Error('Prefix upload coverage transport control is invalid')
    return raw as unknown as PrefixUploadTransportControl
  }
  if (
    raw.mode !== 'discovered-download' ||
    !exactKeys(raw, [
      'blobs',
      'coverage',
      'expiresAt',
      'mode',
      'repository',
      'revision',
      'run',
      'version',
    ])
  )
    throw new Error('Discovered download coverage transport control is invalid')
  parseDownloadMap(raw.coverage, expected, 'coverage')
  parseDownloadMap(raw.blobs, expected, 'blob')
  return raw as unknown as DiscoveredDownloadTransportControl
}
