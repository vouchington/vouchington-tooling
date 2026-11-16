import type { ParsedLine } from './shared.mts'

/**
 * A time window over transcript records. `since` is exclusive and `until` inclusive, matching the
 * journal scope (an event is new when it is created after the boundary). A bound that does not
 * parse as a timestamp is ignored.
 */
export type TranscriptWindow = {
  since?: string
  until?: string
  /** The saved retrospective that set `since`, named in the report. */
  boundary?: string
}

export type WindowedRecords = {
  included: ParsedLine[]
  /** Records at or before `since`, kept so cumulative counters can continue from them. */
  before: ParsedLine[]
  excluded: number
}

/** The window the options ask for; absent unless a bound is given, so no bound changes nothing. */
export function optionsWindow(options: TranscriptWindow): TranscriptWindow | undefined {
  const { since, until, boundary } = options
  if (!since && !until) return undefined
  return {
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
    ...(boundary ? { boundary } : {}),
  }
}

const bound = (value: string | undefined): number => Date.parse(value ?? '')

/** Whether the value is an ISO-style timestamp that `Date.parse` accepts. */
export const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(bound(value))

/** Splits records by window. Records without a parseable `timestamp` are never excluded. */
export function windowRecords(records: ParsedLine[], window?: TranscriptWindow): WindowedRecords {
  const since = bound(window?.since)
  const until = bound(window?.until)
  const included: ParsedLine[] = []
  const before: ParsedLine[] = []
  let excluded = 0
  for (const record of records) {
    const at = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN
    if (at <= since) before.push(record)
    if (at <= since || at > until) excluded++
    else included.push(record)
  }
  return { included, before, excluded }
}
