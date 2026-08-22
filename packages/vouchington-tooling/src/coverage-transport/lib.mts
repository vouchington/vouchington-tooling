import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  DEFAULT_COVERAGE_MANIFEST_FILENAME,
  DEFAULT_MAX_BODY_BYTES,
  assertCoverageManifestFilename,
} from './constants.mts'
import {
  readTransportControl,
  type ExpectedTransportIdentity,
  type RequestOptions,
} from './control.mts'
import { fetchGet, fetchPut, logTransport } from './http.mts'
import { downloadVitestBlobBundles, packVitestBlobBundle } from './vitest-blob-transport.mts'

export { DEFAULT_COVERAGE_MANIFEST_FILENAME } from './constants.mts'

interface UploadOptions extends RequestOptions {
  readonly cwd?: string
  readonly expectedIdentity: ExpectedTransportIdentity
  readonly coverageManifestFilename?: string
}

interface DownloadOptions extends RequestOptions {
  readonly expectedIdentity: ExpectedTransportIdentity
  readonly coverageManifestFilename?: string
}

export async function cmdUpload(
  controlPath: string,
  suite: string,
  options: UploadOptions,
): Promise<{ coverage: boolean; blob: boolean }> {
  const control = readTransportControl(controlPath, options.expectedIdentity)
  if (control.mode === 'fallback-only') {
    logTransport(
      options,
      `[coverage-transport] S3 unavailable for ${suite}; artifact fallback required`,
    )
    return { coverage: false, blob: false }
  }
  const cwd = options.cwd ?? process.cwd()
  const manifestFilename = options.coverageManifestFilename ?? DEFAULT_COVERAGE_MANIFEST_FILENAME
  assertCoverageManifestFilename(manifestFilename)
  const coverageUrls = control.coverage[suite]
  const lcovPath = join(cwd, 'coverage', 'lcov.info')
  const manifestPath = join(cwd, 'coverage', manifestFilename)
  const maxBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const lcov =
    coverageUrls && existsSync(lcovPath) && existsSync(manifestPath)
      ? await readFile(lcovPath)
      : null
  const manifest = lcov === null ? null : await readFile(manifestPath)
  const lcovStored =
    coverageUrls &&
    lcov !== null &&
    manifest !== null &&
    lcov.byteLength <= maxBytes &&
    manifest.byteLength <= maxBytes
      ? await fetchPut(coverageUrls.lcovPut, lcov, options)
      : false
  const coverage =
    lcovStored && coverageUrls && manifest !== null && manifest.byteLength <= maxBytes
      ? await fetchPut(coverageUrls.manifestPut, manifest, options)
      : false
  if (coverageUrls && existsSync(lcovPath) && existsSync(manifestPath)) {
    logTransport(
      options,
      coverage
        ? `[coverage-transport] Uploaded coverage pair for ${suite}`
        : `[coverage-transport] Coverage pair upload failed for ${suite}`,
    )
  }

  const blobUrls = control.blobs[suite]
  const blobData = blobUrls
    ? packVitestBlobBundle(cwd, suite, options.expectedIdentity, options)
    : null
  const blob = Boolean(blobUrls && blobData && (await fetchPut(blobUrls.put, blobData, options)))
  if (blob) logTransport(options, `[coverage-transport] Uploaded vitest blob for ${suite}`)
  else if (blobUrls && blobData) {
    logTransport(options, `[coverage-transport] Vitest blob upload failed for ${suite}`)
  }
  return { coverage, blob }
}

export async function cmdDownloadCoverage(
  controlPath: string,
  destinationRoot: string,
  options: DownloadOptions,
): Promise<void> {
  const control = readTransportControl(controlPath, options.expectedIdentity)
  if (control.mode === 'fallback-only') {
    logTransport(options, '[coverage-transport] S3 unavailable; artifact fallback required')
    return
  }
  const manifestFilename = options.coverageManifestFilename ?? DEFAULT_COVERAGE_MANIFEST_FILENAME
  assertCoverageManifestFilename(manifestFilename)
  await Promise.all(
    Object.entries(control.coverage).map(async ([suite, urls]) => {
      const [lcov, manifest] = await Promise.all([
        fetchGet(urls.lcovGet, options),
        fetchGet(urls.manifestGet, options),
      ])
      if (!lcov || !manifest) {
        logTransport(options, `[coverage-transport] Skipped incomplete coverage pair for ${suite}`)
        return
      }
      const destination = join(destinationRoot, `coverage-${suite}`)
      mkdirSync(destination, { recursive: true })
      writeFileSync(join(destination, 'lcov.info'), lcov)
      writeFileSync(join(destination, manifestFilename), manifest, { mode: 0o600 })
      logTransport(options, `[coverage-transport] Downloaded coverage pair for ${suite}`)
    }),
  )
}

export async function cmdDownloadVitestBlobs(
  controlPath: string,
  destinationRoot: string,
  options: DownloadOptions,
): Promise<void> {
  const control = readTransportControl(controlPath, options.expectedIdentity)
  if (control.mode === 'fallback-only') {
    logTransport(options, '[coverage-transport] S3 unavailable; artifact fallback required')
    return
  }
  await downloadVitestBlobBundles(control.blobs, destinationRoot, options)
}
