import type { RuntimeJobResult, RuntimeSample } from './model.mts'

export interface RuntimeSamplesByJob {
  workflow: string
  job: string
  samples: RuntimeSample[]
}

export type RuntimeThresholds = {
  medianThresholdSeconds: number
  hardCeilingSeconds: number
}

function summarize(entry: RuntimeSamplesByJob, thresholds: RuntimeThresholds): RuntimeJobResult {
  const durations: number[] = []
  for (const sample of entry.samples) durations.push(sample.durationSeconds)
  durations.sort((a, b) => a - b)
  const medianSeconds = durations.length === 5 ? durations[2]! : null
  const reasons: RuntimeJobResult['reasons'] = []
  if (durations.some((duration) => duration >= thresholds.hardCeilingSeconds)) {
    reasons.push('sample-at-or-above-hard-ceiling')
  }
  if (medianSeconds !== null && medianSeconds > thresholds.medianThresholdSeconds) {
    reasons.push('five-sample-median-above-threshold')
  }
  return {
    key: `${entry.workflow} / ${entry.job}`,
    workflow: entry.workflow,
    job: entry.job,
    sampleCount: entry.samples.length,
    medianSeconds,
    maximumSeconds: Math.max(...durations),
    reasons,
    samples: entry.samples,
  }
}

export function violationOrder(a: RuntimeJobResult, b: RuntimeJobResult): number {
  const aHard = a.reasons.includes('sample-at-or-above-hard-ceiling')
  const bHard = b.reasons.includes('sample-at-or-above-hard-ceiling')
  if (aHard && !bHard) return -1
  if (!aHard && bHard) return 1
  const aScore = aHard ? a.maximumSeconds : a.medianSeconds!
  const bScore = bHard ? b.maximumSeconds : b.medianSeconds!
  return bScore - aScore || a.key.localeCompare(b.key)
}

export function buildRuntimeResults(
  samplesByKey: ReadonlyMap<string, RuntimeSamplesByJob>,
  thresholds: RuntimeThresholds,
): {
  jobs: RuntimeJobResult[]
  violations: RuntimeJobResult[]
} {
  const jobs: RuntimeJobResult[] = []
  for (const entry of samplesByKey.values()) jobs.push(summarize(entry, thresholds))
  jobs.sort((a, b) => a.key.localeCompare(b.key))
  const violations: RuntimeJobResult[] = []
  for (const job of jobs) {
    if (job.reasons.length > 0) violations.push(job)
  }
  violations.sort(violationOrder)
  return { jobs, violations }
}
