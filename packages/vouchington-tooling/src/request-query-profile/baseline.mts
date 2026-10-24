import { baselineEntryProblem } from './baseline-validation.mts'
import type { RepeatedAnnotation } from './types.mts'

/** A repeat tolerated until the open `issue` removes it. */
export interface BaselineScope {
  /** Exact request identities, including MCP tool-call identities. */
  routes: string[]
  /** Exact worker identities. Worker scopes never excuse a request repeat. */
  workers?: Array<{ queue: string; job: string }>
  /** Null preserves an intentional unbounded exception within the named scopes. */
  maxCount: number | null
}

export interface TemporaryBaselineEntry extends BaselineScope {
  annotation: string
  reason: string
  /** Number of the open GitHub issue that owns removing the repeat. */
  issue: number
}

/** A repeat the code needs on purpose; the reason names the mechanism. */
export interface PermanentBaselineEntry extends BaselineScope {
  annotation: string
  reason: string
  permanent: true
  /** `<repo path>:<line or symbol>` of the code that needs the repeat. */
  code: string
}

export type RepeatBaselineEntry = TemporaryBaselineEntry | PermanentBaselineEntry

function entryScopes(scoped: RepeatBaselineEntry): string[] {
  return [
    ...scoped.routes.map((route) => JSON.stringify([scoped.annotation, 'route', route])),
    ...(scoped.workers ?? []).map(({ queue, job }) =>
      JSON.stringify([scoped.annotation, 'worker', queue, job]),
    ),
  ]
}

/** Parsed baseline, or an error naming every malformed or duplicate entry. */
export function parseRepeatBaseline(raw: unknown): RepeatBaselineEntry[] {
  if (!Array.isArray(raw)) throw new Error('Query-profile baseline must be an array of entries')
  const problems: string[] = []
  const seenScopes = new Set<string>()
  raw.forEach((entry: unknown, index) => {
    const problem = baselineEntryProblem(entry)
    const name = (entry as { annotation?: unknown } | null)?.annotation
    if (problem) problems.push(`entry ${index} (${JSON.stringify(name)}) ${problem}`)
    else {
      for (const scope of entryScopes(entry as RepeatBaselineEntry)) {
        if (seenScopes.has(scope))
          problems.push(`entry ${index} (${JSON.stringify(name)}) has a duplicate scope ${scope}`)
        seenScopes.add(scope)
      }
    }
  })
  if (problems.length > 0) {
    throw new Error(`Malformed query-profile baseline:\n${problems.join('\n')}`)
  }
  return raw as RepeatBaselineEntry[]
}

/** Temporary entries, whose `issue` must stay open. */
export function temporaryBaselineEntries(
  baseline: readonly RepeatBaselineEntry[],
): TemporaryBaselineEntry[] {
  return baseline.filter((entry): entry is TemporaryBaselineEntry => 'issue' in entry)
}

/** Repeats outside their exact baseline scope and maximum, in the order given. */
export function findUnbaselinedRepeats(
  route: string,
  repeats: readonly RepeatedAnnotation[],
  baseline: readonly RepeatBaselineEntry[],
): RepeatedAnnotation[] {
  return repeats.filter(({ annotation, count }) => {
    return !baseline.some(
      (entry) =>
        entry.annotation === annotation &&
        entry.routes.includes(route) &&
        (entry.maxCount === null || count <= entry.maxCount),
    )
  })
}

/**
 * Failure text for one request: names the route and every unbaselined annotation.
 * `baselineFile` is the repository path of the baseline, shown in the remediation hint.
 */
export function formatUnbaselinedRepeats(
  route: string,
  repeats: readonly RepeatedAnnotation[],
  options: { baselineFile: string },
): string {
  const list = repeats.map(({ annotation, count }) => `${annotation} (x${count})`).join(', ')
  return `Unbaselined repeated query in ${route}: ${list}. Remove the repeat, or baseline it in ${options.baselineFile} with a reason and an open issue (temporary), or a code pointer (permanent).`
}

/**
 * Failure text for temporary entries whose issue is not open, one line per entry. `states` maps an
 * issue number to its GitHub state; an issue missing from it counts as not found. `issueGroup`
 * names where replacement issues live (for example a milestone or issue group title).
 */
export function formatClosedBaselineIssues(
  baseline: readonly RepeatBaselineEntry[],
  states: ReadonlyMap<number, string>,
  options: { issueGroup: string },
): string[] {
  return temporaryBaselineEntries(baseline).flatMap(({ annotation, issue }) => {
    const state = states.get(issue)?.toLowerCase()
    if (state === 'open') return []
    return [
      `Baseline entry ${annotation} points at #${issue}, which is ${state ?? 'not found'}. Remove the repeat, or re-point the entry at an open issue in "${options.issueGroup}"; a repeat the code needs on purpose becomes a permanent entry.`,
    ]
  })
}
