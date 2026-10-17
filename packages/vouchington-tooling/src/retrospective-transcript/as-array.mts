export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
