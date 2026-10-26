/** `package.json` glob for a pnpm workspace package pattern. */
export function manifestGlob(workspacePattern: string): string {
  return `${workspacePattern.replace(/\/$/, '')}/package.json`
}

export function isManifestPath(entry: string): boolean {
  return entry === 'package.json' || entry.endsWith('/package.json')
}

/** Members of a whole-glob brace set (`{a,b}`), or the glob itself. */
export function flattenBraceGlobs(globs: readonly string[]): Set<string> {
  const flattened = new Set<string>()
  for (const glob of globs) {
    const match = /^\{(.*)\}$/.exec(glob)
    const members = match === null ? [glob] : (match[1] as string).split(',')
    for (const member of members) flattened.add(member)
  }
  return flattened
}

export function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

export function expandBraceAlternatives(pattern: string): string[] {
  const match = /\{([^{}]*)\}/.exec(pattern)
  if (match === null) return [pattern]
  const [whole, alternatives] = match as unknown as [string, string]
  return alternatives
    .split(',')
    .flatMap((alternative) => expandBraceAlternatives(pattern.replace(whole, alternative)))
}
