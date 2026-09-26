import { DEFAULT_MAX_BODY_BYTES } from './constants.mts'
import { parseTransportObjectKey, type PrefixTransportIdentity } from './keys.mts'

type DownloadedTransportObject = {
  readonly key: string
  readonly url: string
  readonly attempt: number
  readonly byteLength: number
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).toSorted().join('\0') === keys.toSorted().join('\0')
}

export function validUrl(value: unknown): value is string {
  return typeof value === 'string' && URL.canParse(value) && /^https?:/i.test(value)
}

export function parseObject(
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
