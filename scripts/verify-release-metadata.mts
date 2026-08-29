import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

type ReleaseMetadata = { gitHead?: unknown; version?: unknown }

export function verifyReleaseMetadata(
  metadata: ReleaseMetadata,
  expectedVersion: string,
  expectedGitHead: string,
): void {
  if (metadata.version !== expectedVersion) {
    throw new Error(`published version is ${String(metadata.version)}, expected ${expectedVersion}`)
  }
  if (metadata.gitHead !== expectedGitHead) {
    throw new Error(`published gitHead is ${String(metadata.gitHead)}, expected ${expectedGitHead}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , metadataPath, expectedVersion, expectedGitHead] = process.argv
  if (!metadataPath || !expectedVersion || !expectedGitHead) {
    throw new Error('usage: verify-release-metadata <metadata-path> <version> <git-head>')
  }
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as ReleaseMetadata
  verifyReleaseMetadata(metadata, expectedVersion, expectedGitHead)
}
