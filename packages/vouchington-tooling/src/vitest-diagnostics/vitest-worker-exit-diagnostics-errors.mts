// Shared error-introspection helpers for vitest-worker-exit-diagnostics-reporter.mts. Split out so
// that file stays focused on the Reporter implementation and its own formatting; these two walk an
// arbitrary, possibly-circular error-shaped value (Vitest's SerializedError, or anything nested
// inside it) without assuming a fixed shape, since the "Worker exited unexpectedly" wrapper varies
// by which layer (pool, tinypool-alike, Node) produced it.
const diagnosticPropertyNames = ['name', 'message', 'stack', 'code', 'type', 'workerError', 'cause']

export function collectStringValues(value: unknown, seen = new Set<unknown>()): string[] {
  if (value == null) return []
  if (typeof value === 'string') return [value]
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return [String(value)]
  }
  if (typeof value !== 'object' || seen.has(value)) return []

  seen.add(value)
  const values: string[] = []
  for (const key of diagnosticKeys(value as Record<string, unknown>)) {
    values.push(...collectStringValues((value as Record<string, unknown>)[key], seen))
  }
  return values
}

export function serializeDiagnosticsError(
  error: unknown,
  seen = new Set<unknown>(),
): Record<string, unknown> {
  if (error == null || typeof error !== 'object') return { value: error }
  if (seen.has(error)) return { circular: true }

  seen.add(error)
  const output: Record<string, unknown> = {}
  for (const key of diagnosticKeys(error as Record<string, unknown>)) {
    if (!(key in error)) continue
    const value = (error as Record<string, unknown>)[key]
    output[key] =
      value == null || typeof value !== 'object' ? value : serializeDiagnosticsError(value, seen)
  }
  return output
}

function diagnosticKeys(source: Record<string, unknown>): Set<string> {
  return new Set([...Object.keys(source), ...diagnosticPropertyNames])
}
