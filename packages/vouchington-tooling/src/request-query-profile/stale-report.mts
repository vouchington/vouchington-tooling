import type { RepeatBaselineEntry } from './baseline.mts'
import { collectProfileObservations } from './observations.mts'

/** A report-only candidate containing only the absent scopes from one baseline entry. */
export interface StaleBaselineCandidate {
  index: number
  entry: RepeatBaselineEntry
  fullyStale: boolean
}

/** Report-only candidates. Missing diagnostic kinds are never treated as evidence of absence. */
export interface StaleReport {
  logCount: number
  requestProfileCount: number
  workerProfileCount: number
  malformedRequestProfileCount: number
  malformedWorkerProfileCount: number
  sufficient: boolean
  stale: StaleBaselineCandidate[]
}

/** One complete run is sufficient when it contains every diagnostic kind the baseline uses. */
export const MIN_STALE_EVIDENCE_LOGS = 1

/** Report scopes absent from complete-run request and worker profile logs. */
export function buildStaleReport(
  baseline: readonly RepeatBaselineEntry[],
  logTexts: readonly string[],
  resolveRoute: (route: string) => string,
): StaleReport {
  const observed = collectProfileObservations(logTexts, resolveRoute)
  const requiresRequests = baseline.some((entry) => entry.routes.length > 0)
  const requiresWorkers = baseline.some((entry) => (entry.workers?.length ?? 0) > 0)
  const sufficient =
    logTexts.length >= MIN_STALE_EVIDENCE_LOGS &&
    (observed.requestProfileCount > 0 || observed.workerProfileCount > 0) &&
    (!requiresRequests || observed.requestProfileCount > 0) &&
    (!requiresWorkers || observed.workerProfileCount > 0) &&
    observed.malformedRequestProfileCount === 0 &&
    observed.malformedWorkerProfileCount === 0
  const routeScopes =
    observed.requestProfileCount > 0 && observed.malformedRequestProfileCount === 0
      ? observed.routeScopes
      : new Set(
          baseline.flatMap((entry) =>
            entry.routes.map((route) => JSON.stringify([entry.annotation, route])),
          ),
        )
  const workerScopes =
    observed.workerProfileCount > 0 && observed.malformedWorkerProfileCount === 0
      ? observed.workerScopes
      : new Set(
          baseline.flatMap((entry) =>
            (entry.workers ?? []).map((worker) =>
              JSON.stringify([entry.annotation, worker.queue, worker.job]),
            ),
          ),
        )

  return {
    logCount: logTexts.length,
    requestProfileCount: observed.requestProfileCount,
    workerProfileCount: observed.workerProfileCount,
    malformedRequestProfileCount: observed.malformedRequestProfileCount,
    malformedWorkerProfileCount: observed.malformedWorkerProfileCount,
    sufficient,
    stale: findStaleBaselineEntries(baseline, routeScopes, workerScopes),
  }
}

/** Return copies of entries with only missing named scopes, preserving baseline order. */
export function findStaleBaselineEntries(
  baseline: readonly RepeatBaselineEntry[],
  observedRouteScopes: ReadonlySet<string>,
  observedWorkerScopes: ReadonlySet<string>,
): StaleBaselineCandidate[] {
  return baseline.flatMap((entry, index) => {
    const routes = entry.routes.filter(
      (route) => !observedRouteScopes.has(JSON.stringify([entry.annotation, route])),
    )
    const workers = (entry.workers ?? []).filter(
      (worker) =>
        !observedWorkerScopes.has(JSON.stringify([entry.annotation, worker.queue, worker.job])),
    )
    if (routes.length === 0 && workers.length === 0) return []

    const total = entry.routes.length + (entry.workers?.length ?? 0)
    const stale = routes.length + workers.length
    return [
      {
        index,
        entry: {
          ...entry,
          routes,
          ...(entry.workers === undefined ? {} : { workers }),
        } as RepeatBaselineEntry,
        fullyStale: stale === total,
      },
    ]
  })
}
