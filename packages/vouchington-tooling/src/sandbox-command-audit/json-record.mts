import { asRecord } from '../retrospective-transcript/index.mts'

/**
 * Parses one transcript line into an object, or undefined for a blank, malformed, partially
 * written or non-object line. Only parsing is guarded: callers run their own logic outside it, so
 * an error from an injected rule is never mistaken for a malformed line.
 */
export function parseJsonRecord(line: string): Record<string, unknown> | undefined {
  if (!line.trim()) return undefined
  try {
    return asRecord(JSON.parse(line))
  } catch {
    return undefined
  }
}
