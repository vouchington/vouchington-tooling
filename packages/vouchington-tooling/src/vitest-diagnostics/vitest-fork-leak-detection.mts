// Fork-side growth-delta leak detector for Vitest's reused forks pool.
// It spans setup-file resets with one episode per type and stable candidate plateau.
// Episodes combine new high-water marks with rolling samples for transient-high recovery.

export { formatForkLeakDiagnostics } from './vitest-fork-leak-diagnostics.mts'
import {
  createForkLeakEpisode,
  findForkLeakEpisodeEvidence,
  recordForkLeakEpisode,
  setForkLeakCandidate,
  takeConfirmedForkLeakCandidate,
  type ForkLeakEpisode,
  type ForkLeakGrowthStep,
} from './vitest-fork-leak-episode.mts'

const realSetTimeout = globalThis.setTimeout

const PERSISTENT_HANDLE_TYPES: ReadonlySet<string> = new Set([
  'TCPSocketWrap',
  'TCPServerWrap',
  'PipeWrap',
  'TLSWrap',
  'UDPWrap',
  'FSEvent',
  'StatWatcher',
  'ProcessWrap',
  'MessagePortData',
])

export const WARMUP_CHECKPOINTS = 5
export const LEAK_THRESHOLD = 4
export const SUSTAINED_CHECKPOINTS = 5

export type ForkLeakVerdict = {
  type: string
  baseline: number
  current: number
  streak: number
  growthCheckpoints: number
  requiredGrowthCheckpoints: number
  detectedInFile: string | null
  suspectedGrowth: ForkLeakGrowthStep | null
}

export type ForkLeakDetectorOptions = {
  trackedTypes?: ReadonlySet<string>
  warmupCheckpoints?: number
  leakThreshold?: number
  sustainedCheckpoints?: number
}

export type ForkLeakDetector = {
  record(counts: ReadonlyMap<string, number>, testFile?: string | null): ForkLeakVerdict[]
}

export function waitForResourceCloseCallbacks(): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, 0))
}

// Baselines live (no static list to go stale) and flags at most once per type, so a confirmed
// leak fails the test it's detected in without cascading into every subsequent test in the fork.
export function createForkLeakDetector(options: ForkLeakDetectorOptions = {}): ForkLeakDetector {
  const trackedTypes = options.trackedTypes ?? PERSISTENT_HANDLE_TYPES
  const warmupCheckpoints = options.warmupCheckpoints ?? WARMUP_CHECKPOINTS
  const leakThreshold = options.leakThreshold ?? LEAK_THRESHOLD
  const sustainedCheckpoints = options.sustainedCheckpoints ?? SUSTAINED_CHECKPOINTS
  const requiredGrowthCheckpoints = growthCheckpointRequirement(sustainedCheckpoints)

  const baseline = new Map<string, number>()
  const previousCounts = new Map<string, number>()
  const episodes = new Map<string, ForkLeakEpisode>()
  const reported = new Set<string>()
  let checkpoint = 0

  return {
    record(counts, testFile = null) {
      checkpoint += 1
      const verdicts: ForkLeakVerdict[] = []

      for (const type of trackedTypes) {
        const current = counts.get(type) ?? 0
        const previous = previousCounts.get(type) ?? current
        previousCounts.set(type, current)

        if (checkpoint <= warmupCheckpoints) {
          baseline.set(type, Math.max(baseline.get(type) ?? 0, current))
          episodes.delete(type)
          continue
        }

        const base = baseline.get(type)!
        if (current <= base + leakThreshold) {
          episodes.delete(type)
          continue
        }

        let episode = episodes.get(type)
        if (!episode) {
          episode = createForkLeakEpisode(base, previous, current, testFile)
          episodes.set(type, episode)
        } else {
          recordForkLeakEpisode(episode, previous, current, testFile, sustainedCheckpoints)
        }

        const confirmedEvidence = takeConfirmedForkLeakCandidate(
          episode,
          previous,
          current,
          testFile,
          sustainedCheckpoints,
        )
        if (confirmedEvidence) {
          if (!reported.has(type)) {
            reported.add(type)
            verdicts.push({
              type,
              baseline: base,
              current,
              streak: confirmedEvidence.age,
              growthCheckpoints: confirmedEvidence.growthCheckpoints,
              requiredGrowthCheckpoints,
              detectedInFile: testFile,
              suspectedGrowth: confirmedEvidence.suspectedGrowth,
            })
          }
          episodes.delete(type)
        } else {
          const evidence = findForkLeakEpisodeEvidence(
            episode,
            current,
            sustainedCheckpoints,
            requiredGrowthCheckpoints,
          )
          for (const signal of evidence) setForkLeakCandidate(episode, signal)
          if (episode.plateauCheckpoints >= sustainedCheckpoints) {
            baseline.set(type, episode.plateauCandidate)
            episodes.delete(type)
          }
        }
      }

      return verdicts
    },
  }
}

function growthCheckpointRequirement(sustainedCheckpoints: number): number {
  return Math.floor(sustainedCheckpoints / 2) + 1
}
