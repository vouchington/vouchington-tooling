import type { RuntimeJobResult, RuntimeSample } from './model.mts'
import type { RuntimeSamplesByJob } from './results.mts'

const SETUP_STEP = /checkout|setup-|action-setup|cache|install|download|^post /i

export type FamilyThresholds = {
  medianFloorSeconds: number | null
  medianThresholdSeconds: number
}

type FamilyBucket = {
  workflow: string
  family: string
  jobs: Set<string>
  samples: RuntimeSample[]
}

export function buildFamilyResults(
  samplesByKey: ReadonlyMap<string, RuntimeSamplesByJob>,
  thresholds: FamilyThresholds,
): RuntimeJobResult[] {
  if (thresholds.medianFloorSeconds === null) return []
  const families = new Map<string, FamilyBucket>()
  for (const entry of samplesByKey.values()) {
    const family = entry.job.replace(/ \([^)]*\)$/, '')
    const key = `${entry.workflow} / ${family}`
    const bucket = families.get(key) ?? {
      workflow: entry.workflow,
      family,
      jobs: new Set<string>(),
      samples: [],
    }
    bucket.jobs.add(entry.job)
    for (const sample of entry.samples) bucket.samples.push(sample)
    families.set(key, bucket)
  }
  const results: RuntimeJobResult[] = []
  for (const [key, bucket] of families) {
    if (bucket.jobs.size < 2) continue
    results.push(familyResult(key, bucket, thresholds.medianFloorSeconds, thresholds))
  }
  return results
}

function familyResult(
  key: string,
  bucket: FamilyBucket,
  floorSeconds: number,
  thresholds: FamilyThresholds,
): RuntimeJobResult {
  const durations = bucket.samples.map((sample) => sample.durationSeconds)
  const medianSeconds = medianDuration(durations)
  const belowFloor = medianSeconds < floorSeconds
  const reasons: RuntimeJobResult['reasons'] = []
  if (belowFloor) reasons.push('family-median-below-floor')
  return {
    key,
    workflow: bucket.workflow,
    job: bucket.family,
    sampleCount: bucket.samples.length,
    medianSeconds,
    maximumSeconds: Math.max(...durations),
    reasons,
    samples: bucket.samples,
    shardCount: bucket.jobs.size,
    setupShare: setupShare(bucket.samples),
    ...(belowFloor
      ? {
          suggestedShardCount: suggestedShardCount(
            bucket.jobs.size,
            medianSeconds,
            thresholds.medianThresholdSeconds,
          ),
        }
      : {}),
  }
}

function medianDuration(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]!
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

function setupShare(samples: readonly RuntimeSample[]): number | null {
  let setupSeconds = 0
  let totalSeconds = 0
  for (const sample of samples) {
    for (const step of sample.steps ?? []) {
      totalSeconds += step.durationSeconds
      if (isSetupStep(step.name)) setupSeconds += step.durationSeconds
    }
  }
  if (totalSeconds === 0) return null
  return setupSeconds / totalSeconds
}

function isSetupStep(name: string): boolean {
  return SETUP_STEP.test(name)
}

function suggestedShardCount(
  shardCount: number,
  medianSeconds: number,
  medianCeilingSeconds: number,
): number {
  return Math.max(1, Math.round((shardCount * medianSeconds) / medianCeilingSeconds))
}
