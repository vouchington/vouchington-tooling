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

function jsonDrifts(
  document: Record<string, unknown>,
  patches: readonly JsonPatch[],
  path: string,
): KeyDrift[] {
  const drifts: KeyDrift[] = []
  for (const patch of patches) {
    const current = getJsonPath(document, patch.path)
    if (!sameValue(current, patch.value)) {
      drifts.push({ current, desired: patch.value, key: patch.path.join('.'), path })
    }
  }
  return drifts
}

export function applyJsonPatches(
  source: string,
  patches: readonly JsonPatch[],
  path: string,
): { drifts: KeyDrift[]; text: string } {
  const document = parseJsonObject(source, path)
  const drifts = jsonDrifts(document, patches, path)
  if (drifts.length === 0) return { drifts, text: source === '' ? '{}\n' : source }
  for (const patch of patches) setJsonPath(document, patch.path, patch.value)
  return { drifts, text: `${JSON.stringify(document, null, 2)}\n` }
}
