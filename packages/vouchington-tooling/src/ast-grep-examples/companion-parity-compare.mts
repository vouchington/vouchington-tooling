export function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function pointer(path: string, key: string | number): string {
  const segment = String(key).replaceAll('~', '~0').replaceAll('/', '~1')
  return `${path}/${segment}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || prototype === Object.prototype
}

export function assertJsonValue(value: unknown, ancestors = new WeakSet<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('unsupported cyclic YAML value')
    ancestors.add(value)
    for (const item of value) assertJsonValue(item, ancestors)
    ancestors.delete(value)
    return
  }
  if (isRecord(value)) {
    if (ancestors.has(value)) throw new Error('unsupported cyclic YAML value')
    ancestors.add(value)
    for (const item of Object.values(value)) assertJsonValue(item, ancestors)
    ancestors.delete(value)
    return
  }
  throw new Error('unsupported non-JSON YAML value')
}

export function compare(
  base: unknown,
  companion: unknown,
  path: string,
  difference: (path: string, base: unknown, companion: unknown) => void,
): void {
  if (Object.is(base, companion)) return
  if (Array.isArray(base) && Array.isArray(companion)) {
    const length = Math.max(base.length, companion.length)
    for (let index = 0; index < length; index++)
      compare(base[index], companion[index], pointer(path, index), difference)
    return
  }
  if (isRecord(base) && isRecord(companion)) {
    for (const key of [...new Set([...Object.keys(base), ...Object.keys(companion)])].toSorted(
      compareCodeUnits,
    ))
      compare(base[key], companion[key], pointer(path, key), difference)
    return
  }
  difference(path, base, companion)
}
