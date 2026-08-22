import picomatch from 'picomatch'

import type { ResolvedWorkspaceGatesOptions } from './options.mts'
import type { AnyObj } from './yaml-loader.mts'

function isRecord(value: unknown): value is AnyObj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function checkDependabotCrosslist(
  dependabot: AnyObj,
  errors: string[],
  options: ResolvedWorkspaceGatesOptions,
): void {
  const updates = Array.isArray(dependabot['updates']) ? (dependabot['updates'] as unknown[]) : []
  const npmUpdate = updates.find(
    (entry): entry is AnyObj =>
      isRecord(entry) && entry['package-ecosystem'] === 'npm' && entry['directory'] === '/',
  )
  if (!npmUpdate) return

  const cooldown = npmUpdate['cooldown']
  const rawExclude =
    isRecord(cooldown) && Array.isArray(cooldown['exclude'])
      ? (cooldown['exclude'] as unknown[])
      : []
  for (const entry of rawExclude) {
    if (typeof entry !== 'string') {
      errors.push(
        `::error file=${options.dependabotPath}::${options.dependabotPath}: npm cooldown.exclude entry ${JSON.stringify(entry)} must be a string glob pattern`,
      )
    }
  }
  const patterns = rawExclude.filter((entry): entry is string => typeof entry === 'string')
  const matchers = patterns.map((pattern) => picomatch(pattern))
  for (const name of options.firstPartyNames) {
    if (!matchers.some((match) => match(name))) {
      errors.push(
        `::error file=${options.dependabotPath}::${options.dependabotPath}: "${name}" is in ${options.workspaceYamlPath} minimumReleaseAgeExclude but not covered by npm cooldown.exclude — add it or a matching glob`,
      )
    }
  }
}
