export function readPackageVersion(parsed: unknown): string {
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
    throw new Error('package.json is missing version')
  }
  const { version } = parsed as { version: unknown }
  if (typeof version !== 'string') throw new Error('package.json version must be a string')
  return version
}
