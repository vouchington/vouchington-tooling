import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  DiscoveredDownloadTransportControl,
  PrefixUploadTransportControl,
} from './control-v2.mts'
import { DEFAULT_COVERAGE_MANIFEST_FILENAME } from './constants.mts'
import type { ExpectedTransportIdentity, RequestOptions } from './control.mts'
import { fetchGet, fetchPost, logTransport } from './http.mts'
import { transportObjectKeysV2 } from './keys.mts'
import { downloadVitestBlobBundles, packVitestBlobBundle } from './vitest-blob-transport.mts'

function identity(control: PrefixUploadTransportControl | DiscoveredDownloadTransportControl) {
  return {
    repository: control.repository,
    revision: control.revision,
    runId: control.run.id,
    controlAttempt: control.run.controlAttempt,
  }
}

export async function uploadPrefixTransport(
  control: PrefixUploadTransportControl,
  suite: string,
  cwd: string,
  expectedIdentity: ExpectedTransportIdentity,
  manifestFilename: string,
  options: RequestOptions,
): Promise<{ coverage: boolean; blob: boolean }> {
  if (control.run.controlAttempt !== expectedIdentity.currentAttempt)
    throw new Error('Prefix transport control attempt does not match the producer attempt')
  if (manifestFilename !== DEFAULT_COVERAGE_MANIFEST_FILENAME)
    throw new Error('Prefix transport requires the default coverage manifest filename')
  const keys = transportObjectKeysV2(identity(control), suite)
  const lcovPath = join(cwd, 'coverage', 'lcov.info')
  const manifestPath = join(cwd, 'coverage', manifestFilename)
  const lcov = existsSync(lcovPath) && existsSync(manifestPath) ? await readFile(lcovPath) : null
  const manifest = lcov === null ? null : await readFile(manifestPath)
  const storedLcov =
    lcov !== null && lcov.byteLength <= control.upload.maxObjectBytes
      ? await fetchPost(control.upload.url, control.upload.fields, keys.lcov, lcov, options)
      : false
  const coverage =
    storedLcov && manifest !== null && manifest.byteLength <= control.upload.maxObjectBytes
      ? await fetchPost(control.upload.url, control.upload.fields, keys.manifest, manifest, options)
      : false
  if (lcov !== null)
    logTransport(
      options,
      coverage
        ? `[coverage-transport] Uploaded coverage pair for ${suite}`
        : `[coverage-transport] Coverage pair upload failed for ${suite}`,
    )
  const blobData = packVitestBlobBundle(cwd, suite, expectedIdentity, options)
  const blob = Boolean(
    blobData &&
    blobData.byteLength <= control.upload.maxObjectBytes &&
    (await fetchPost(control.upload.url, control.upload.fields, keys.blob, blobData, options)),
  )
  if (blob) logTransport(options, `[coverage-transport] Uploaded vitest blob for ${suite}`)
  else if (blobData)
    logTransport(options, `[coverage-transport] Vitest blob upload failed for ${suite}`)
  return { coverage, blob }
}

export async function downloadPrefixCoverage(
  control: DiscoveredDownloadTransportControl,
  destinationRoot: string,
  manifestFilename: string,
  options: RequestOptions,
): Promise<void> {
  if (manifestFilename !== DEFAULT_COVERAGE_MANIFEST_FILENAME)
    throw new Error('Prefix transport requires the default coverage manifest filename')
  await Promise.all(
    Object.entries(control.coverage).map(async ([suite, pair]) => {
      const [lcov, manifest] = await Promise.all([
        fetchGet(pair.lcov.url, options),
        fetchGet(pair.manifest.url, options),
      ])
      if (!lcov || !manifest)
        return logTransport(
          options,
          `[coverage-transport] Skipped incomplete coverage pair for ${suite}`,
        )
      const destination = join(destinationRoot, `coverage-${suite}`)
      mkdirSync(destination, { recursive: true })
      writeFileSync(join(destination, 'lcov.info'), lcov)
      writeFileSync(join(destination, manifestFilename), manifest, { mode: 0o600 })
      logTransport(options, `[coverage-transport] Downloaded coverage pair for ${suite}`)
    }),
  )
}

export async function downloadPrefixBlobs(
  control: DiscoveredDownloadTransportControl,
  destinationRoot: string,
  options: RequestOptions,
): Promise<void> {
  await downloadVitestBlobBundles(
    Object.fromEntries(
      Object.entries(control.blobs).map(([suite, object]) => [
        suite,
        { get: object.url, put: 'unused' },
      ]),
    ),
    destinationRoot,
    options,
  )
}
