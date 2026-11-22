/** Repository-specific label names the batch preflight validates against. */
export type BatchPolicy = {
  /** The priority labels an entry may use; at most one may resolve onto an entry. */
  priorityLabels: readonly string[]
  /** Label auto-added to entries that declare dependencies. */
  dependenciesLabel: string
}

export const CANONICAL_PRIORITIES = [
  'priority: critical',
  'priority: high',
  'priority: medium',
  'priority: low',
] as const

export const DEFAULT_BATCH_POLICY: BatchPolicy = {
  priorityLabels: CANONICAL_PRIORITIES,
  dependenciesLabel: 'dependencies',
}
