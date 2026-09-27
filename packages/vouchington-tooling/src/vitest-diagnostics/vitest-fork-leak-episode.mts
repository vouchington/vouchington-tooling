export type ForkLeakGrowthStep = {
  testFile: string | null
  previous: number
  current: number
  delta: number
}
type ForkLeakSample = ForkLeakGrowthStep
type ForkLeakEvidenceKind = 'primary' | 'rolling'

export type ForkLeakEpisode = {
  baseline: number
  start: number
  highWater: number
  age: number
  growthCheckpoints: number
  largestGrowthStep: ForkLeakGrowthStep | null
  plateauCandidate: number
  plateauCheckpoints: number
  samples: ForkLeakSample[]
  pendingCandidate: ForkLeakCandidate | null
  rejectedHighWater: Record<ForkLeakEvidenceKind, number>
}

export type ForkLeakEpisodeEvidence = {
  kind: ForkLeakEvidenceKind
  age: number
  growthCheckpoints: number
  highWater: number
  suspectedGrowth: ForkLeakGrowthStep | null
}

type ForkLeakCandidate = ForkLeakEpisodeEvidence & { createdAt: number }

export function createForkLeakEpisode(
  baseline: number,
  previous: number,
  current: number,
  testFile: string | null,
): ForkLeakEpisode {
  const sample = makeSample(previous, current, testFile)
  return {
    baseline,
    start: current,
    highWater: current,
    age: 1,
    growthCheckpoints: sample.delta > 0 ? 1 : 0,
    largestGrowthStep: sample.delta > 0 ? sample : null,
    plateauCandidate: current,
    plateauCheckpoints: 0,
    samples: [sample],
    pendingCandidate: null,
    rejectedHighWater: { primary: Number.NEGATIVE_INFINITY, rolling: Number.NEGATIVE_INFINITY },
  }
}

export function recordForkLeakEpisode(
  episode: ForkLeakEpisode,
  previous: number,
  current: number,
  testFile: string | null,
  sustainedCheckpoints: number,
): void {
  episode.age += 1
  const sample = makeSample(previous, current, testFile)
  episode.samples.push(sample)
  if (episode.samples.length > sustainedCheckpoints) episode.samples.shift()
  if (current === episode.plateauCandidate) {
    episode.plateauCheckpoints += 1
  } else {
    episode.plateauCandidate = current
    episode.plateauCheckpoints = 0
  }
  if (current > episode.highWater) {
    episode.highWater = current
    episode.growthCheckpoints += 1
    if (!episode.largestGrowthStep || sample.delta > episode.largestGrowthStep.delta) {
      episode.largestGrowthStep = sample
    }
  }
}

export function findForkLeakEpisodeEvidence(
  episode: ForkLeakEpisode,
  current: number,
  sustainedCheckpoints: number,
  requiredGrowthCheckpoints: number,
): ForkLeakEpisodeEvidence[] {
  const evidence: ForkLeakEpisodeEvidence[] = []
  if (
    episode.age >= sustainedCheckpoints &&
    episode.growthCheckpoints >= requiredGrowthCheckpoints &&
    current > episode.start
  ) {
    evidence.push({
      kind: 'primary',
      age: episode.age,
      growthCheckpoints: episode.growthCheckpoints,
      highWater: episode.highWater,
      suspectedGrowth: episode.largestGrowthStep,
    })
  }
  const rollingEvidence = findRollingEvidence(
    episode.samples,
    current,
    sustainedCheckpoints,
    requiredGrowthCheckpoints,
  )
  if (rollingEvidence) evidence.push(rollingEvidence)
  return evidence
}

export function takeConfirmedForkLeakCandidate(
  episode: ForkLeakEpisode,
  previous: number,
  current: number,
  testFile: string | null,
  sustainedCheckpoints: number,
): ForkLeakEpisodeEvidence | null {
  const candidate = episode.pendingCandidate
  if (!candidate) return null
  if (episode.age - candidate.createdAt > sustainedCheckpoints) {
    episode.rejectedHighWater[candidate.kind] = Math.max(
      episode.rejectedHighWater[candidate.kind],
      candidate.highWater,
    )
    episode.pendingCandidate = null
    return null
  }
  if (current <= candidate.highWater) return null

  episode.pendingCandidate = null
  const delta = current - previous
  const confirmation = delta > 0 ? { testFile, previous, current, delta } : null
  return {
    ...candidate,
    suspectedGrowth:
      confirmation &&
      (!candidate.suspectedGrowth || confirmation.delta > candidate.suspectedGrowth.delta)
        ? confirmation
        : candidate.suspectedGrowth,
  }
}

export function setForkLeakCandidate(
  episode: ForkLeakEpisode,
  evidence: ForkLeakEpisodeEvidence,
): void {
  if (evidence.highWater <= episode.rejectedHighWater[evidence.kind]) return

  const candidate = episode.pendingCandidate
  if (candidate?.kind === 'primary' && evidence.kind === 'rolling') {
    episode.rejectedHighWater.primary = Math.max(
      episode.rejectedHighWater.primary,
      candidate.highWater,
    )
  }
  if (
    !candidate ||
    (candidate.kind === 'primary' &&
      evidence.kind === 'rolling' &&
      evidence.highWater < candidate.highWater) ||
    (candidate.kind === evidence.kind && evidence.highWater > candidate.highWater)
  ) {
    episode.pendingCandidate = { ...evidence, createdAt: episode.age }
  }
}

function findRollingEvidence(
  samples: readonly ForkLeakSample[],
  current: number,
  sustainedCheckpoints: number,
  requiredGrowthCheckpoints: number,
): ForkLeakEpisodeEvidence | null {
  if (samples.length !== sustainedCheckpoints || current <= samples[0]!.current) return null

  const positiveSamples: ForkLeakSample[] = []
  let highWater = Number.NEGATIVE_INFINITY
  for (const sample of samples) {
    if (sample.current <= highWater) continue
    highWater = sample.current
    if (sample.delta > 0) positiveSamples.push(sample)
  }
  if (positiveSamples.length < requiredGrowthCheckpoints) return null

  const suspectedGrowth = positiveSamples.reduce<ForkLeakGrowthStep | null>(
    (largest, sample) => (!largest || sample.delta > largest.delta ? sample : largest),
    null,
  )
  return {
    kind: 'rolling',
    age: sustainedCheckpoints,
    growthCheckpoints: positiveSamples.length,
    highWater,
    suspectedGrowth,
  }
}

function makeSample(previous: number, current: number, testFile: string | null): ForkLeakSample {
  return { testFile, previous, current, delta: current - previous }
}
