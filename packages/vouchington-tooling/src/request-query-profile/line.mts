import type { RepeatedAnnotation, RequestQuerySummary } from './types.mts'

export const REQUEST_PROFILE_PREFIX = '[pg-request-profile]'

/** A parsed request profile line. */
export interface ParsedRequestProfileLine {
  route: string
  queries: number
  serialDepth: number
  repeats: RepeatedAnnotation[]
}

/** One stderr line for a request, or null when it has nothing to report and `all` is off. */
export function formatRequestProfileLine(
  route: string,
  summary: RequestQuerySummary,
  options: { all: boolean },
): string | null {
  if (summary.repeats.length === 0 && !options.all) return null
  const repeats = summary.repeats
    .map(({ annotation, count }) => `${annotation}(x${count})`)
    .join(',')
  return `${REQUEST_PROFILE_PREFIX} route=${route} queries=${summary.totalQueries} serialDepth=${summary.serialDepth} repeats=${repeats || 'none'}\n`
}

/** Parse the repeats field; undefined when any entry is malformed or counts fewer than 2. */
function parseRepeats(repeats: string): RepeatedAnnotation[] | undefined {
  if (repeats === '' || repeats === 'none') return []
  const parsed: RepeatedAnnotation[] = []
  for (const value of repeats.split(',')) {
    const match = /^(.+?)\(x(\d+)\)$/.exec(value)
    if (!match?.[1]?.trim() || Number(match[2]) < 2) return undefined
    parsed.push({ annotation: match[1], count: Number(match[2]) })
  }
  return parsed
}

/**
 * Parse a line containing the profile prefix (leading log noise is skipped), or undefined when it
 * is malformed. The inverse of `formatRequestProfileLine`.
 */
export function parseRequestProfileLine(line: string): ParsedRequestProfileLine | undefined {
  const start = line.indexOf(REQUEST_PROFILE_PREFIX)
  if (start === -1) return undefined
  const profile = line.slice(start).trimEnd()
  const match = / route=(.+?) queries=(\d+) serialDepth=(\d+) repeats=(.*)$/.exec(profile)
  const route = match?.[1]
  const repeats = match?.[4]
  const parsed = repeats === undefined ? undefined : parseRepeats(repeats)
  if (!route || parsed === undefined) return undefined
  return {
    route,
    queries: Number(match?.[2]),
    serialDepth: Number(match?.[3]),
    repeats: parsed,
  }
}
