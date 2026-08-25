import type { PrefixPostTarget, PrefixUploadTransportControl } from './control-v2.mts'
import { DEFAULT_MAX_BODY_BYTES } from './constants.mts'
import { parseTransportControl } from './control.mts'
import { transportPrefix, type PrefixTransportIdentity } from './keys.mts'

export interface PrefixPostSigner {
  signPost(keyPrefix: string, ttlSeconds: number, maxObjectBytes: number): Promise<PrefixPostTarget>
}

export interface MintPrefixUploadOptions {
  readonly ttlSeconds?: number
  readonly maxObjectBytes?: number
  readonly now?: () => Date
}

export const DEFAULT_TRANSPORT_TTL_SECONDS = 14_400

export function transportExpiresAt(options: MintPrefixUploadOptions): string {
  const ttl = options.ttlSeconds ?? DEFAULT_TRANSPORT_TTL_SECONDS
  if (!Number.isSafeInteger(ttl) || ttl < 1) throw new Error('Coverage transport TTL is invalid')
  return new Date((options.now?.() ?? new Date()).getTime() + ttl * 1000).toISOString()
}

export async function mintPrefixUploadControl(
  value: PrefixTransportIdentity,
  signer: PrefixPostSigner,
  options: MintPrefixUploadOptions = {},
): Promise<PrefixUploadTransportControl> {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TRANSPORT_TTL_SECONDS
  const maxObjectBytes = options.maxObjectBytes ?? DEFAULT_MAX_BODY_BYTES
  if (
    !Number.isSafeInteger(maxObjectBytes) ||
    maxObjectBytes < 1 ||
    maxObjectBytes > DEFAULT_MAX_BODY_BYTES
  )
    throw new Error('Coverage transport size limit is invalid')
  const upload = await signer.signPost(`${transportPrefix(value)}/`, ttlSeconds, maxObjectBytes)
  return parseTransportControl({
    version: 2,
    mode: 'prefix-upload',
    repository: value.repository,
    revision: value.revision,
    run: { id: value.runId, controlAttempt: value.controlAttempt },
    expiresAt: transportExpiresAt(options),
    upload,
  }) as PrefixUploadTransportControl
}
