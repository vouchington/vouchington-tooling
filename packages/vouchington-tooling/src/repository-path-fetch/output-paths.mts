import { canonicalizeNearestExistingPath } from './canonical-path.mts'
import { pathsOverlap } from './path-overlap.mts'
import { publishMarkerPath } from './publish.mts'
import { validateDestination } from './validation.mts'

export function validateOutputPaths(destination: string, metadata: string): void {
  validateDestination(destination)
  validateDestination(metadata)
  const canonicalDestination = canonicalizeNearestExistingPath(destination)
  const canonicalMetadata = canonicalizeNearestExistingPath(metadata)
  const canonicalMarker = canonicalizeNearestExistingPath(publishMarkerPath(destination))
  if (
    pathsOverlap(canonicalDestination, canonicalMetadata) ||
    pathsOverlap(canonicalMarker, canonicalMetadata)
  )
    throw new Error('destination and metadata overlap')
}
