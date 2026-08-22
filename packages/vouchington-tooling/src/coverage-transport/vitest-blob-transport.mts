import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'

import type { ExpectedTransportIdentity, PresignedBlobUrls, RequestOptions } from './control.mts'
import { fetchGet, logTransport, redactTransportLog } from './http.mts'
import {
  inspectVitestBlobBundle,
  VITEST_BLOB_MANIFEST_FILENAME,
  VITEST_SUITE_PATTERN,
  vitestBlobBundlePaths,
  writeVitestBlobManifest,
} from '../vitest-blob-manifest/index.mts'

function archivePath(suite: string): string {
  assertVitestSuite(suite)
  return join(tmpdir(), `ct-blob-${suite}-${randomUUID()}.tar.gz`)
}

function assertVitestSuite(suite: string): void {
  if (!VITEST_SUITE_PATTERN.test(suite)) throw new Error('Invalid Vitest suite')
}

export function packVitestBlobBundle(
  cwd: string,
  suite: string,
  identity: ExpectedTransportIdentity,
  options: RequestOptions,
): Buffer | null {
  const directory = join(cwd, '.vitest-reports')
  const archive = archivePath(suite)
  try {
    writeVitestBlobManifest(directory, {
      suite,
      repository: identity.repository,
      revision: identity.revision,
      runId: identity.runId,
      runAttempt: identity.currentAttempt,
    })
    const paths = vitestBlobBundlePaths(directory, suite).map((path) => basename(path))
    execFileSync('tar', ['czf', archive, '-C', directory, ...paths], {
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    return readFileSync(archive)
  } catch (error) {
    logTransport(
      options,
      `[coverage-transport] vitest blob pack failed: ${redactTransportLog(error)}`,
    )
    return null
  } finally {
    try {
      unlinkSync(archive)
    } catch {
      // The process temp directory is swept independently.
    }
  }
}

function validateArchive(archive: string, suite: string): readonly string[] {
  const entries = execFileSync('tar', ['tzf', archive], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  const expected = [VITEST_BLOB_MANIFEST_FILENAME, `${suite}.json`].toSorted()
  if (entries.length !== 2 || entries.toSorted().join('\0') !== expected.join('\0')) {
    throw new Error(`Vitest blob archive for ${suite} has unexpected entries`)
  }
  const verbose = execFileSync('tar', ['tvzf', archive], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  if (verbose.length !== 2 || verbose.some((line) => !line.startsWith('-'))) {
    throw new Error(`Vitest blob archive for ${suite} must contain regular files`)
  }
  return entries
}

function extractValidatedBundle(archive: string, destinationRoot: string, suite: string): void {
  const entries = validateArchive(archive, suite)
  mkdirSync(destinationRoot, { recursive: true })
  const temporary = mkdtempSync(join(destinationRoot, `.vitest-blob-${suite}-`))
  try {
    execFileSync('tar', ['xzf', archive, '-C', temporary, ...entries], {
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    for (const entry of entries) chmodSync(join(temporary, entry), 0o600)
    inspectVitestBlobBundle(temporary)
    const destination = join(destinationRoot, `vitest-blob-${suite}`)
    rmSync(destination, { recursive: true, force: true })
    renameSync(temporary, destination)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

export async function downloadVitestBlobBundles(
  blobs: Readonly<Record<string, PresignedBlobUrls>>,
  destinationRoot: string,
  options: RequestOptions,
): Promise<void> {
  mkdirSync(destinationRoot, { recursive: true })
  await Promise.all(
    Object.entries(blobs).map(async ([suite, urls]) => {
      assertVitestSuite(suite)
      const data = await fetchGet(urls.get, options)
      if (!data) {
        logTransport(options, `[coverage-transport] No vitest blob available for ${suite}`)
        return
      }
      const archive = archivePath(suite)
      const invalidMarker = join(destinationRoot, `.invalid-${suite}`)
      try {
        writeFileSync(archive, data, { flag: 'wx', mode: 0o600 })
        extractValidatedBundle(archive, destinationRoot, suite)
        rmSync(invalidMarker, { recursive: true, force: true })
        logTransport(options, `[coverage-transport] Downloaded vitest blob for ${suite}`)
      } catch (error) {
        try {
          rmSync(invalidMarker, { force: true })
          writeFileSync(invalidMarker, 'invalid archive\n', { flag: 'wx', mode: 0o600 })
        } catch {
          // The original archive failure is more actionable than a diagnostic-write failure.
        }
        throw error
      } finally {
        try {
          unlinkSync(archive)
        } catch {
          // The process temp directory is swept independently.
        }
      }
    }),
  )
}
