import { posix } from 'node:path'
import type { RepositoryPathMapping } from './validation.mts'
import { portableFilesystemIdentity } from './validation.mts'

export function selectedDestination(mapping: RepositoryPathMapping, sourcePath: string): string {
  return sourcePath === mapping.source
    ? mapping.destination
    : posix.join(mapping.destination, posix.relative(mapping.source, sourcePath))
}

export function rejectPortableOutputCollisions(destinations: readonly string[]): void {
  const identities = new Set<string>()
  for (const destination of destinations) {
    const identity = portableFilesystemIdentity(destination)
    if (identities.has(identity)) throw new Error(`selected output path collision: ${destination}`)
    identities.add(identity)
  }
}
