export const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/

export function matchNames(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].flatMap((match) => (match[1] ? [match[1]] : []))
}

export function sorted(values: Iterable<string>): string[] {
  return [...values].toSorted((a, b) => a.localeCompare(b))
}
