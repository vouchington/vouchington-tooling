export type FreshBaseFetch = 'fresh' | 'skipped' | 'failed'
export type FreshBaseTree = 'clean' | 'dirty' | 'unknown'
export type FreshBaseRelation = 'matches' | 'behind' | 'ahead' | 'diverged' | 'unknown'
export type FreshBaseStatus =
  | 'up-to-date'
  | 'ahead'
  | 'behind'
  | 'diverged'
  | 'dirty'
  | 'fetch-failed'
  | 'unknown'

export interface FreshBaseInput {
  /** Commits on HEAD that the base lacks; null when the comparison was unavailable. */
  readonly ahead: number | null
  /** Commits on the base that HEAD lacks; null when the comparison was unavailable. */
  readonly behind: number | null
  readonly tree: FreshBaseTree
  readonly fetch: FreshBaseFetch
}

export interface FreshBaseClassification extends FreshBaseInput {
  readonly status: FreshBaseStatus
  readonly relation: FreshBaseRelation
  /** True for every status except `up-to-date`. */
  readonly needsAttention: boolean
}

export function relationOf(ahead: number | null, behind: number | null): FreshBaseRelation {
  if (ahead === null || behind === null) return 'unknown'
  if (ahead === 0 && behind === 0) return 'matches'
  if (ahead === 0) return 'behind'
  if (behind === 0) return 'ahead'
  return 'diverged'
}

function statusOf(relation: FreshBaseRelation, input: FreshBaseInput): FreshBaseStatus {
  // A failed refresh means a cached "matches" is not evidence of freshness.
  if (input.fetch === 'failed') return 'fetch-failed'
  if (relation === 'unknown') return 'unknown'
  if (relation !== 'matches') return relation
  if (input.tree === 'dirty') return 'dirty'
  return input.tree === 'clean' ? 'up-to-date' : 'unknown'
}

/** Pure classification of a worktree against its base from already-gathered facts. */
export function classifyFreshBase(input: FreshBaseInput): FreshBaseClassification {
  const relation = relationOf(input.ahead, input.behind)
  const status = statusOf(relation, input)
  return { ...input, relation, status, needsAttention: status !== 'up-to-date' }
}
