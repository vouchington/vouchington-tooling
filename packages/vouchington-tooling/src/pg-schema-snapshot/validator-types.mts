import type { PartitionPolicy } from './types.mts'

/**
 * Optional narrowing of the partition policy facts. An omitted list accepts
 * every value the published `PartitionPolicy` type allows (any string for
 * `retentionOwner` and `accessClass`).
 */
export type PartitionPolicyOptions = {
  strategies?: readonly PartitionPolicy['strategy'][]
  children?: readonly PartitionPolicy['children'][]
  retentionOwners?: readonly string[]
  accessClasses?: readonly string[]
}

export type ValidateSchemaSnapshotOptions = {
  /** Path used in `::error file=` diagnostics, as the repository tracks it. */
  snapshotPath: string
  partitionPolicy?: PartitionPolicyOptions
}
