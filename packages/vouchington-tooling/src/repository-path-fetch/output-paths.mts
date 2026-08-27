import { pathsOverlap } from './path-overlap.mts'
import { publishMarkerPath } from './publish.mts'
import { validateDestination } from './validation.mts'

export function validateOutputPaths(destination: string, metadata: string): void {
  validateDestination(destination)
  validateDestination(metadata)
  if (pathsOverlap(destination, metadata) || pathsOverlap(publishMarkerPath(destination), metadata))
    throw new Error('destination and metadata overlap')
}
