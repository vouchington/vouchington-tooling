import type {
  DiscoveredDownloadTransportControl,
  DownloadedTransportObject,
  PrefixUploadTransportControl,
} from './control-v2.mts'
import { DEFAULT_MAX_BODY_BYTES } from './constants.mts'
import { parseTransportControl } from './control.mts'
import {
  parseTransportObjectKey,
  type PrefixTransportIdentity,
  type TransportObjectKey,
} from './keys.mts'
import {
  DEFAULT_TRANSPORT_TTL_SECONDS,
  transportExpiresAt,
  type MintPrefixUploadOptions,
} from './prefix.mts'

export const MAX_DISCOVERED_TRANSPORT_OBJECTS = 1024
export interface ObjectGetSigner {
  signGet(key: string, ttlSeconds: number): Promise<string>
}
export interface ListedTransportObject {
  readonly key: string
  readonly byteLength: number
}
export interface TransportObjectLister {
  list(
    prefix: string,
    continuationToken?: string,
  ): Promise<{
    readonly objects: readonly ListedTransportObject[]
    readonly continuationToken?: string
  }>
}
interface Candidate {
  readonly object: ListedTransportObject
  readonly parsed: TransportObjectKey
}

function identity(control: PrefixUploadTransportControl): PrefixTransportIdentity {
  return {
    repository: control.repository,
    revision: control.revision,
    runId: control.run.id,
    controlAttempt: control.run.controlAttempt,
  }
}

async function listCandidates(
  identity: PrefixTransportIdentity,
  lister: TransportObjectLister,
): Promise<Candidate[]> {
  const result: Candidate[] = []
  const tokens = new Set<string>()
  const keys = new Set<string>()
  let continuationToken: string | undefined
  do {
    const page = await lister.list(
      `coverage-transport/${identity.repository}/${identity.runId}/${identity.revision}/`,
      continuationToken,
    )
    if (
      !Array.isArray(page.objects) ||
      page.objects.length + result.length > MAX_DISCOVERED_TRANSPORT_OBJECTS
    )
      throw new Error('Coverage transport discovery exceeds object limit')
    for (const object of page.objects) {
      if (
        !object ||
        typeof object.key !== 'string' ||
        !Number.isSafeInteger(object.byteLength) ||
        object.byteLength < 0 ||
        object.byteLength > DEFAULT_MAX_BODY_BYTES
      )
        throw new Error('Coverage transport discovery object is invalid')
      if (keys.has(object.key))
        throw new Error('Coverage transport discovery has duplicate object keys')
      keys.add(object.key)
      const parsed = parseTransportObjectKey(object.key, identity)
      if (!parsed) throw new Error('Coverage transport discovery key is invalid')
      result.push({ object, parsed })
    }
    if (page.continuationToken !== undefined && typeof page.continuationToken !== 'string')
      throw new Error('Coverage transport discovery continuation token is invalid')
    continuationToken = page.continuationToken
    if (continuationToken) {
      if (tokens.has(continuationToken))
        throw new Error('Coverage transport discovery pagination is cyclic')
      tokens.add(continuationToken)
    }
  } while (continuationToken)
  return result
}

function newest(
  candidates: readonly Candidate[],
  kind: TransportObjectKey['kind'],
): Candidate | undefined {
  return candidates
    .filter((candidate) => candidate.parsed.kind === kind)
    .toSorted((a, b) => b.parsed.attempt - a.parsed.attempt)[0]
}

export async function discoverDownloadControl(
  source: PrefixUploadTransportControl,
  lister: TransportObjectLister,
  signer: ObjectGetSigner,
  options: MintPrefixUploadOptions = {},
): Promise<DiscoveredDownloadTransportControl> {
  const value = identity(source)
  const candidates = await listCandidates(value, lister)
  const suites = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const entries = suites.get(candidate.parsed.suite)
    if (entries) entries.push(candidate)
    else suites.set(candidate.parsed.suite, [candidate])
  }
  const coverage: Record<
    string,
    { lcov: DownloadedTransportObject; manifest: DownloadedTransportObject }
  > = {}
  const blobs: Record<string, DownloadedTransportObject> = {}
  const object = async (candidate: Candidate): Promise<DownloadedTransportObject> => ({
    key: candidate.object.key,
    attempt: candidate.parsed.attempt,
    byteLength: candidate.object.byteLength,
    url: await signer.signGet(
      candidate.object.key,
      options.ttlSeconds ?? DEFAULT_TRANSPORT_TTL_SECONDS,
    ),
  })
  await Promise.all(
    [...suites].map(async ([suite, entries]) => {
      const attempts = [...new Set(entries.map((entry) => entry.parsed.attempt))].toSorted(
        (a, b) => b - a,
      )
      const pair = attempts
        .map((attempt) => entries.filter((entry) => entry.parsed.attempt === attempt))
        .map((entries) => ({
          lcov: newest(entries, 'lcov'),
          manifest: newest(entries, 'manifest'),
        }))
        .find((pair) => pair.lcov && pair.manifest)
      if (pair?.lcov && pair.manifest) {
        const [lcov, manifest] = await Promise.all([object(pair.lcov), object(pair.manifest)])
        coverage[suite] = { lcov, manifest }
      }
      const blob = newest(entries, 'blob')
      if (blob) blobs[suite] = await object(blob)
    }),
  )
  return parseTransportControl({
    version: 2,
    mode: 'discovered-download',
    repository: value.repository,
    revision: value.revision,
    run: { id: value.runId, controlAttempt: value.controlAttempt },
    expiresAt: transportExpiresAt(options),
    coverage,
    blobs,
  }) as DiscoveredDownloadTransportControl
}
