import { join } from 'node:path'
import { labelsFromPaths } from '../labels-from-paths.mts'
import { findIntraBatchCollisions, type IntraBatchCollision } from './intra-dedup.mts'
import type { BatchEntry, BatchManifest } from './manifest.mts'
import type { BatchPolicy } from './policy.mts'
import { evaluateEntry, type EntryReport } from './resolve-entry.mts'
import { fetchTaxonomy, searchDuplicates, type Taxonomy } from './taxonomy.mts'

export type PreflightDeps = {
  runGh: (args: string[]) => Promise<string>
  pathExists: (path: string) => Promise<boolean>
  readBody: (path: string) => Promise<string>
  labelerPath: string
  sessionDir: string
  policy?: BatchPolicy | undefined
}

export type PreflightReport = {
  targetRepo: string
  status: 'pass' | 'blocked'
  entries: EntryReport[]
}

async function missingPathsFor(
  paths: string[],
  pathExists: (path: string) => Promise<boolean>,
): Promise<string[]> {
  const results = await Promise.all(
    paths.map(async (path) => ({ path, exists: await pathExists(path) })),
  )
  return results.reduce<string[]>((missing, result) => {
    if (!result.exists) missing.push(result.path)
    return missing
  }, [])
}

// Blocks on both an unreadable body file and one that reads as empty/whitespace-only — an
// entry cannot pass preflight with a body `gh issue create` would file as blank.
async function readBodyOk(
  path: string,
  readBody: (path: string) => Promise<string>,
): Promise<boolean> {
  try {
    const body = await readBody(path)
    return body.trim().length > 0
  } catch {
    return false
  }
}

// The four checks below are mutually independent (different inputs, no ordering
// requirement), so they run concurrently within one entry. Only entries themselves are
// evaluated one at a time (see the caller's loop) to keep the per-batch `gh` call count
// deterministic and easy to reason about.
async function evaluateSingleEntry(
  entry: BatchEntry,
  taxonomy: Taxonomy,
  intraBatchCollisions: IntraBatchCollision[],
  manifest: BatchManifest,
  deps: PreflightDeps,
): Promise<EntryReport> {
  const [pathLabels, missingPaths, bodyOk, duplicates] = await Promise.all([
    labelsFromPaths(entry.paths, deps.labelerPath),
    missingPathsFor(entry.paths, deps.pathExists),
    readBodyOk(join(deps.sessionDir, entry.bodyFile), deps.readBody),
    searchDuplicates(manifest.targetRepo, entry.duplicateSearch.query, deps),
  ])

  return evaluateEntry({
    entry,
    pathLabels,
    taxonomy,
    duplicates,
    intraBatchCollisions,
    missingPaths,
    bodyOk,
    policy: deps.policy,
  })
}

/**
 * Fail-closed preflight over an entire manifest. Fetches the live taxonomy exactly once,
 * then evaluates every entry — never stopping early — so a single report surfaces every
 * blocking problem across the whole batch at once. Bounded `gh` call budget: 3 (auth,
 * labels, milestones) + N (one duplicate search per entry).
 */
export async function executePreflight(
  manifest: BatchManifest,
  deps: PreflightDeps,
): Promise<PreflightReport> {
  const taxonomy = await fetchTaxonomy(manifest.targetRepo, deps)
  const allCollisions = findIntraBatchCollisions(manifest.entries)

  const entries: EntryReport[] = []
  for (const entry of manifest.entries) {
    const intraBatchCollisions = allCollisions.filter(
      (collision) => collision.a === entry.id || collision.b === entry.id,
    )
    // Entries are evaluated one at a time (not Promise.all across entries) so the
    // duplicate-search `gh` calls stay serial and the total call budget stays deterministic.
    // oxlint-disable-next-line no-await-in-loop
    entries.push(await evaluateSingleEntry(entry, taxonomy, intraBatchCollisions, manifest, deps))
  }

  return {
    targetRepo: manifest.targetRepo,
    status: entries.some((entry) => entry.status === 'blocked') ? 'blocked' : 'pass',
    entries,
  }
}
