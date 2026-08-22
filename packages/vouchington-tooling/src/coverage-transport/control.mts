import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs'

import { VITEST_SUITE_PATTERN } from '../vitest-blob-manifest/index.mts'

export interface PresignedCoverageUrls {
  lcovPut: string
  lcovGet: string
  manifestPut: string
  manifestGet: string
}

export interface PresignedBlobUrls {
  put: string
  get: string
}

interface TransportControlBase {
  readonly version: 1
  readonly repository: string
  readonly revision: string
  readonly run: { readonly id: string; readonly controlAttempt: number }
}

export interface PresignedTransportControl extends TransportControlBase {
  readonly mode: 'presigned'
  readonly expiresAt: string
  readonly coverage: Record<string, PresignedCoverageUrls>
  readonly blobs: Record<string, PresignedBlobUrls>
}

export interface FallbackOnlyTransportControl extends TransportControlBase {
  readonly mode: 'fallback-only'
  readonly reason: string
}

export type TransportControl = PresignedTransportControl | FallbackOnlyTransportControl

export interface ExpectedTransportIdentity {
  readonly repository: string
  readonly revision: string
  readonly runId: string
  readonly currentAttempt: number
}

export interface RequestOptions {
  readonly retryDelayMs?: number
  readonly log?: (line: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function assertUrlMap(
  raw: unknown,
  fields: readonly string[],
  label: string,
): asserts raw is Record<string, Record<string, string>> {
  if (!isRecord(raw)) throw new Error(`${label} URL map must be an object`)
  for (const [suite, urls] of Object.entries(raw)) {
    if (
      !VITEST_SUITE_PATTERN.test(suite) ||
      !isRecord(urls) ||
      Object.keys(urls).toSorted().join('\0') !== fields.toSorted().join('\0')
    ) {
      throw new Error(`${label} URL map has an invalid entry`)
    }
    for (const field of fields) {
      const value = urls[field]
      if (typeof value !== 'string' || !URL.canParse(value) || !/^https?:/.test(value)) {
        throw new Error(`${label} URL map has an invalid URL`)
      }
    }
  }
}

export function parseTransportControl(raw: unknown): TransportControl {
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.run)) {
    throw new Error('Coverage transport control has an unsupported schema')
  }
  if (
    typeof raw.repository !== 'string' ||
    !raw.repository ||
    typeof raw.revision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(raw.revision) ||
    typeof raw.run.id !== 'string' ||
    !/^[1-9][0-9]*$/.test(raw.run.id) ||
    !positiveInteger(raw.run.controlAttempt)
  ) {
    throw new Error('Coverage transport control has invalid identity fields')
  }
  if (Object.keys(raw.run).toSorted().join('\0') !== ['controlAttempt', 'id'].join('\0')) {
    throw new Error('Coverage transport control run schema is invalid')
  }
  if (raw.mode === 'fallback-only') {
    const fallbackKeys = ['mode', 'reason', 'repository', 'revision', 'run', 'version']
    if (
      Object.keys(raw).toSorted().join('\0') !== fallbackKeys.toSorted().join('\0') ||
      typeof raw.reason !== 'string' ||
      !raw.reason
    ) {
      throw new Error('Fallback-only coverage transport control is invalid')
    }
    return raw as unknown as FallbackOnlyTransportControl
  }
  const presignedKeys = [
    'blobs',
    'coverage',
    'expiresAt',
    'mode',
    'repository',
    'revision',
    'run',
    'version',
  ]
  if (
    raw.mode !== 'presigned' ||
    Object.keys(raw).toSorted().join('\0') !== presignedKeys.toSorted().join('\0') ||
    typeof raw.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.expiresAt))
  ) {
    throw new Error('Presigned coverage transport control is invalid')
  }
  assertUrlMap(raw.coverage, ['lcovGet', 'lcovPut', 'manifestGet', 'manifestPut'], 'Coverage')
  assertUrlMap(raw.blobs, ['get', 'put'], 'Blob')
  return raw as unknown as PresignedTransportControl
}

export function writeTransportControl(path: string, control: TransportControl): void {
  const validated = parseTransportControl(control)
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export function readTransportControl(
  path: string,
  expected?: ExpectedTransportIdentity,
): TransportControl {
  if ((statSync(path).mode & 0o777) !== 0o600) {
    throw new Error('Coverage transport control file must have mode 0600')
  }
  const control = parseTransportControl(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  if (
    expected &&
    (control.repository !== expected.repository ||
      control.revision !== expected.revision ||
      control.run.id !== expected.runId ||
      control.run.controlAttempt > expected.currentAttempt)
  ) {
    throw new Error('Coverage transport control identity does not match this run')
  }
  if (control.mode === 'presigned' && Date.parse(control.expiresAt) <= Date.now()) {
    throw new Error('Coverage transport control has expired')
  }
  return control
}
