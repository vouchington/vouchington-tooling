import { assertWorkflowCommandData, canonicalScopePath } from './paths.mts'
import type { SccComplexityOptions, SccComplexityScope } from './types.mts'

export function scopesFor(options: SccComplexityOptions): readonly SccComplexityScope[] {
  if (!options.scopes) {
    if (options.baseline) throw new Error('baseline requires named scopes')
    return [{ includePaths: [], name: '', ...options }]
  }
  if (options.scopes.length === 0) throw new Error('scopes must not be empty')
  const names = new Set<string>()
  for (const scope of options.scopes) {
    if (!scope.name || names.has(scope.name))
      throw new Error(`scope name ${scope.name || '(empty)'} is invalid`)
    assertWorkflowCommandData(scope.name, 'scope name')
    if (scope.includePaths.length === 0 || scope.includePaths.some((path) => !path))
      throw new Error(`scope ${scope.name} must include at least one path`)
    for (const path of scope.includePaths)
      assertWorkflowCommandData(path, `scope ${scope.name} path`)
    names.add(scope.name)
  }
  return options.scopes
}

export async function normalizeScopes(
  scopes: readonly SccComplexityScope[],
  repoRoot: string,
  topLevelLimit: number | undefined,
): Promise<readonly SccComplexityScope[]> {
  return Promise.all(
    scopes.map(async (scope) => {
      let includePaths: string[]
      try {
        includePaths = await Promise.all(
          scope.includePaths.map((path) => canonicalScopePath(repoRoot, path)),
        )
      } catch {
        throw new Error(`scope ${scope.name} includes a path outside the repository`)
      }
      const limit = scope.limit ?? topLevelLimit
      return limit === undefined ? { ...scope, includePaths } : { ...scope, includePaths, limit }
    }),
  )
}
