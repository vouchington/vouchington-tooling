import { sameValue } from './policy.mts'
import type { JsonPatch, KeyDrift } from './types.mts'

function getJsonPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function setJsonPath(
  target: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  let current = target
  for (const key of path.slice(0, -1)) {
    const next = current[key]
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }
  const last = path.at(-1)
  if (last !== undefined) current[last] = value
}

function parseJsonObject(source: string, path: string): Record<string, unknown> {
  if (source.trim() === '') return {}
  const parsed: unknown = JSON.parse(source)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path}: expected a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function unionMerge(current: unknown, values: readonly unknown[]): unknown[] {
  const base = Array.isArray(current) ? current : []
  const merged = [...base]
  for (const value of values) {
    if (!merged.some((entry) => sameValue(entry, value))) merged.push(value)
  }
  return merged
}

function desiredValue(document: Record<string, unknown>, patch: JsonPatch): unknown {
  if (patch.merge !== 'union') return patch.value
  return unionMerge(getJsonPath(document, patch.path), patch.value as readonly unknown[])
}

export function applyJsonPatches(
  source: string,
  patches: readonly JsonPatch[],
  path: string,
): { drifts: KeyDrift[]; text: string } {
  const document = parseJsonObject(source, path)
  const resolved = patches.map((patch) => ({ desired: desiredValue(document, patch), patch }))
  const drifts: KeyDrift[] = []
  for (const { desired, patch } of resolved) {
    const current = getJsonPath(document, patch.path)
    if (!sameValue(current, desired)) {
      drifts.push({ current, desired, key: patch.path.join('.'), path })
    }
  }
  if (drifts.length === 0) return { drifts, text: source === '' ? '{}\n' : source }
  for (const { desired, patch } of resolved) setJsonPath(document, patch.path, desired)
  return { drifts, text: `${JSON.stringify(document, null, 2)}\n` }
}
