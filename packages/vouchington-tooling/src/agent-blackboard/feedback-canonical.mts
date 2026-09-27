import { isObject } from './snapshot-partition-guards.mts'
export function canonicalFeedback(value: unknown): string {
  return JSON.stringify(ordered(value))
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, ordered(value[key])]),
  )
}
