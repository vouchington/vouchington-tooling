import type { IntraBatchCollision } from './intra-dedup.mts'
import type { BatchEntry } from './manifest.mts'
import type { DuplicateCandidate, Taxonomy } from './taxonomy.mts'

/**
 * Merges the canonical priority, path-derived labels, manifest-declared extras, and the
 * caller-required `dependencies` label — auto-added whenever `entry.dependencies` is non-empty,
 * the same rule the one-at-a-time skill flow applies to dependency-owned issues.
 */
function resolveEntryLabels(entry: BatchEntry, pathLabels: string[]): string[] {
  return Array.from(
    new Set([
      entry.priority,
      ...pathLabels,
      ...entry.extraLabels,
      ...(entry.dependencies.length > 0 ? ['dependencies'] : []),
    ]),
  )
}

type BlockedReason = {
  code:
    | 'unknown-label'
    | 'unknown-milestone'
    | 'missing-paths'
    | 'body-unreadable'
    | 'duplicate-existing'
    | 'duplicate-in-batch'
    | 'duplicate-priority'
  detail: string
}

export type EntryReport = {
  id: string
  status: 'pass' | 'blocked'
  resolvedLabels: string[]
  milestone: string | null
  blocked: BlockedReason[]
}

export type EvaluateEntryParams = {
  entry: BatchEntry
  pathLabels: string[]
  taxonomy: Taxonomy
  duplicates: DuplicateCandidate[]
  intraBatchCollisions: IntraBatchCollision[]
  missingPaths: string[]
  bodyOk: boolean
}

/**
 * Runs every safeguard for one manifest entry and never short-circuits: every check below
 * always runs, so a single report can surface every problem with an entry at once instead
 * of requiring one preflight run per fix.
 */
export function evaluateEntry(params: EvaluateEntryParams): EntryReport {
  const { entry, pathLabels, taxonomy, duplicates, intraBatchCollisions, missingPaths, bodyOk } =
    params
  const blocked: BlockedReason[] = []
  const resolvedLabels = resolveEntryLabels(entry, pathLabels)

  for (const label of resolvedLabels) {
    if (!taxonomy.labels.has(label)) {
      blocked.push({
        code: 'unknown-label',
        detail: `label "${label}" is not in the live taxonomy.`,
      })
    }
  }

  const priorityLabels = resolvedLabels.filter((label) => label.startsWith('priority:'))
  if (priorityLabels.length > 1) {
    blocked.push({
      code: 'duplicate-priority',
      detail: `resolved labels include more than one priority label: ${priorityLabels.join(', ')}.`,
    })
  }

  if (entry.milestone !== null && !taxonomy.milestones.has(entry.milestone)) {
    blocked.push({
      code: 'unknown-milestone',
      detail: `milestone "${entry.milestone}" is not in the live taxonomy.`,
    })
  }

  if (missingPaths.length > 0) {
    blocked.push({
      code: 'missing-paths',
      detail: `paths do not exist: ${missingPaths.join(', ')}`,
    })
  }

  if (!bodyOk) {
    blocked.push({
      code: 'body-unreadable',
      detail: `body file "${entry.bodyFile}" could not be read.`,
    })
  }

  // Every search hit blocks unless the author explicitly acknowledged it as non-duplicate:
  // `gh issue list --search` returns related, not only duplicate, issues, so treating an
  // unacknowledged hit as safe would be fail-open for the exact case this check exists for.
  for (const duplicate of duplicates) {
    if (!entry.duplicateSearch.acknowledgedHits.includes(duplicate.number)) {
      blocked.push({
        code: 'duplicate-existing',
        detail: `possible duplicate of existing issue #${duplicate.number}: ${duplicate.url} (add ${duplicate.number} to duplicateSearch.acknowledgedHits if this is not a duplicate).`,
      })
    }
  }

  for (const collision of intraBatchCollisions) {
    const other = collision.a === entry.id ? collision.b : collision.a
    blocked.push({
      code: 'duplicate-in-batch',
      detail: `similar title to batch entry "${other}" (similarity ${collision.similarity.toFixed(2)}).`,
    })
  }

  return {
    id: entry.id,
    status: blocked.length === 0 ? 'pass' : 'blocked',
    resolvedLabels,
    milestone: entry.milestone,
    blocked,
  }
}
