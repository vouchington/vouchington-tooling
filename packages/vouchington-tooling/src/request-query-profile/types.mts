/** One annotation that ran more than once within a request or worker job. */
export interface RepeatedAnnotation {
  annotation: string
  count: number
}

/** Structural shape of a per-request query summary; any compatible telemetry summary fits. */
export interface RequestQuerySummary {
  totalQueries: number
  serialDepth: number
  repeats: readonly RepeatedAnnotation[]
}
