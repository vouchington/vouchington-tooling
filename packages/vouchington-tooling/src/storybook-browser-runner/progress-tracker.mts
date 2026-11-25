// Every collection here is capped, so a long suite cannot grow the tracker without bound.
const MAX_RECENT_MARKERS = 10
const MAX_TRACKED_MODULES = 64
const MAX_REPORTED_MODULES = 10

type MarkerEvent = 'module-collected' | 'module-start' | 'module-end' | 'test-start' | 'test-end'

export type ProgressMarker = {
  at: number
  event: MarkerEvent
  module: string
  seq: number
  test: string | null
}

type TrackedModule = {
  startedAt: number | null
  test: { at: number; name: string } | null
}

export type StallContext = {
  collectedNotStarted: string[]
  inFlight: Array<{
    module: string
    runningForMs: number
    test: { name: string; runningForMs: number } | null
  }>
  lastEnded: { endedAgoMs: number; module: string } | null
  recentMarkers: Array<{
    agoMs: number
    event: MarkerEvent
    module: string
    seq: number
    test?: string
  }>
}

const quoted = String.raw`"(?:[^"\\]|\\.)*"`

function unquote(text: string): string {
  try {
    return JSON.parse(text) as string
  } catch {
    return text.slice(1, -1)
  }
}

/** Reads progress marker lines and remembers which modules and tests are still running. */
export class ProgressTracker {
  private lastEnded: { at: number; module: string } | null = null
  private lastSeq = 0
  private readonly modules = new Map<string, TrackedModule>()
  private readonly pattern: RegExp
  private readonly recent: ProgressMarker[] = []

  constructor(prefix: string) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    this.pattern = new RegExp(
      `${escaped} seq=(\\d+) event=(module-collected|module-start|module-end|test-start|test-end) module=(${quoted})(?: test=(${quoted}))?\\r?\\n`,
      'g',
    )
  }

  /** Records each complete marker line in `text` that is newer than the last one recorded. */
  observe(text: string, now: number): void {
    for (const match of text.matchAll(this.pattern)) {
      const seq = Number(match[1])
      if (!Number.isSafeInteger(seq) || seq <= this.lastSeq) continue
      this.lastSeq = seq
      this.record({
        at: now,
        event: match[2] as MarkerEvent,
        module: unquote(match[3]!),
        seq,
        test: match[4] == null ? null : unquote(match[4]),
      })
    }
  }

  /** What was in flight at `now`, for the stall log and the diagnostics artifact. */
  context(now: number): StallContext {
    const running = [...this.modules].filter(([, tracked]) => tracked.startedAt != null)
    return {
      collectedNotStarted: [...this.modules]
        .filter(([, tracked]) => tracked.startedAt == null)
        .map(([module]) => module)
        .slice(0, MAX_REPORTED_MODULES),
      inFlight: running.slice(0, MAX_REPORTED_MODULES).map(([module, tracked]) => ({
        module,
        runningForMs: now - tracked.startedAt!,
        test: tracked.test && { name: tracked.test.name, runningForMs: now - tracked.test.at },
      })),
      lastEnded: this.lastEnded && {
        endedAgoMs: now - this.lastEnded.at,
        module: this.lastEnded.module,
      },
      recentMarkers: this.recent.map((marker) => ({
        agoMs: now - marker.at,
        event: marker.event,
        module: marker.module,
        seq: marker.seq,
        ...(marker.test == null ? {} : { test: marker.test }),
      })),
    }
  }

  private record(marker: ProgressMarker): void {
    this.recent.push(marker)
    if (this.recent.length > MAX_RECENT_MARKERS) this.recent.shift()
    const { at, event, module, test } = marker
    if (event === 'module-end') {
      this.modules.delete(module)
      this.lastEnded = { at, module }
      return
    }
    const tracked = this.track(module)
    if (event === 'module-start') tracked.startedAt = at
    if (event === 'test-start') {
      tracked.startedAt ??= at
      tracked.test = { at, name: test ?? '' }
    }
    if (event === 'test-end' && tracked.test?.name === (test ?? '')) tracked.test = null
  }

  private track(module: string): TrackedModule {
    let tracked = this.modules.get(module)
    if (!tracked) {
      tracked = { startedAt: null, test: null }
      this.modules.set(module, tracked)
      if (this.modules.size > MAX_TRACKED_MODULES) {
        this.modules.delete(this.modules.keys().next().value!)
      }
    }
    return tracked
  }
}
