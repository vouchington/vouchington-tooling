import type { PresignedTransportControl } from './control.mts'
import { DEFAULT_COVERAGE_MANIFEST_FILENAME } from './constants.mts'

const DEFAULT_PRESIGN_TTL_SECONDS = 14_400

export interface PresignIdentity {
  readonly repository: string
  readonly revision: string
  readonly runId: string
  readonly controlAttempt: number
}

export interface ObjectSigner {
  signPut(key: string): Promise<string>
  signGet(key: string): Promise<string>
}

export interface MintPresignedControlOptions {
  readonly ttlSeconds?: number
  readonly now?: () => Date
  readonly manifestFilename?: string
}

export function transportObjectKeys(
  runId: string,
  controlAttempt: number,
  suite: string,
  manifestFilename = DEFAULT_COVERAGE_MANIFEST_FILENAME,
): {
  readonly lcov: string
  readonly manifest: string
  readonly blob: string
} {
  if (
    !/^[1-9][0-9]*$/.test(runId) ||
    !Number.isSafeInteger(controlAttempt) ||
    controlAttempt < 1 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(suite)
  ) {
    throw new Error('Coverage transport key identity is invalid')
  }
  const prefix = `coverage-transport/${runId}/${controlAttempt}`
  return {
    lcov: `${prefix}/coverage/${suite}/lcov.info`,
    manifest: `${prefix}/coverage/${suite}/${manifestFilename}`,
    blob: `${prefix}/blobs/${suite}.tar.gz`,
  }
}

export async function mintPresignedControl(
  identity: PresignIdentity,
  coverageSuites: readonly string[],
  blobSuites: readonly string[],
  signer: ObjectSigner,
  options: MintPresignedControlOptions = {},
): Promise<PresignedTransportControl> {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_PRESIGN_TTL_SECONDS
  const expiresAt = new Date((options.now?.() ?? new Date()).getTime() + ttlSeconds * 1000)
  const manifestFilename = options.manifestFilename ?? DEFAULT_COVERAGE_MANIFEST_FILENAME
  const control: PresignedTransportControl = {
    version: 1,
    mode: 'presigned',
    repository: identity.repository,
    revision: identity.revision,
    run: { id: identity.runId, controlAttempt: identity.controlAttempt },
    expiresAt: expiresAt.toISOString(),
    coverage: {},
    blobs: {},
  }

  for (const suite of coverageSuites) {
    const keys = transportObjectKeys(
      identity.runId,
      identity.controlAttempt,
      suite,
      manifestFilename,
    )
    control.coverage[suite] = {
      lcovPut: await signer.signPut(keys.lcov),
      lcovGet: await signer.signGet(keys.lcov),
      manifestPut: await signer.signPut(keys.manifest),
      manifestGet: await signer.signGet(keys.manifest),
    }
  }
  for (const suite of blobSuites) {
    const key = transportObjectKeys(
      identity.runId,
      identity.controlAttempt,
      suite,
      manifestFilename,
    ).blob
    control.blobs[suite] = {
      put: await signer.signPut(key),
      get: await signer.signGet(key),
    }
  }
  return control
}
