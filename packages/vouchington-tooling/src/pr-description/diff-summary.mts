import { countDiffLineChanges } from '../pull-request-diff/index.mts'
import type { DiffSummary } from './pr-description-types.mts'
import {
  parseChangedPackageJsonPaths,
  parseRemovedSurfaces,
  type ParseRemovedSurfacesOptions,
} from './removed-surfaces.mts'

export function createDiffSummary(): DiffSummary {
  return { changedPackageJsonPaths: [], lineChanges: { added: 0, deleted: 0 }, removedSurfaces: [] }
}

/** Reduces one complete unified-diff file block without retaining the surrounding patch. */
export function reduceDiffBlock(
  summary: DiffSummary,
  block: string,
  options?: ParseRemovedSurfacesOptions,
): void {
  const changes = countDiffLineChanges(block)
  summary.lineChanges.added += changes.added
  summary.lineChanges.deleted += changes.deleted
  summary.removedSurfaces.push(...parseRemovedSurfaces(block, options))
  for (const path of parseChangedPackageJsonPaths(block)) {
    if (!summary.changedPackageJsonPaths.includes(path)) summary.changedPackageJsonPaths.push(path)
  }
}
