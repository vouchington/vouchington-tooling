export const DEFAULT_COVERAGE_MANIFEST_FILENAME = 'coverage-manifest.json'

const MANIFEST_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/

export function assertCoverageManifestFilename(filename: string): void {
  if (
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..') ||
    !MANIFEST_FILENAME_PATTERN.test(filename)
  ) {
    throw new Error('Coverage manifest filename is invalid')
  }
}
