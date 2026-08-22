import type { ResolvedWorkspaceGatesOptions } from './options.mts'
import type { AnyObj } from './yaml-loader.mts'

export function checkExcludeRegistry(
  workspace: AnyObj,
  errors: string[],
  options: ResolvedWorkspaceGatesOptions,
): void {
  const raw = workspace['minimumReleaseAgeExclude']
  const yamlEntries = Array.isArray(raw)
    ? (raw as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : []
  const yamlNames = new Set<string>()
  for (const name of yamlEntries) {
    if (yamlNames.has(name)) {
      errors.push(
        `::error file=${options.workspaceYamlPath}::${options.workspaceYamlPath}: minimumReleaseAgeExclude duplicates "${name}"`,
      )
    }
    yamlNames.add(name)
  }

  const registryNames = new Set(options.firstPartyNames)
  const temporarySelectors = new Set(options.temporarySelectors)
  for (const name of yamlNames) {
    if (!registryNames.has(name) && !temporarySelectors.has(name)) {
      errors.push(
        `::error file=${options.workspaceYamlPath}::${options.workspaceYamlPath}: minimumReleaseAgeExclude contains "${name}" which is not in a release-age exemption registry`,
      )
    }
  }
  for (const name of registryNames) {
    if (!yamlNames.has(name)) {
      errors.push(
        `::error file=${options.workspaceYamlPath}::${options.workspaceYamlPath}: first-party package "${name}" is in the ${options.firstPartyRegistryLabel} but missing from minimumReleaseAgeExclude`,
      )
    }
  }
  for (const selector of temporarySelectors) {
    if (!yamlNames.has(selector)) {
      errors.push(
        `::error file=${options.workspaceYamlPath}::${options.workspaceYamlPath}: temporary release-age exemption "${selector}" is in the ${options.firstPartyRegistryLabel} but missing from minimumReleaseAgeExclude`,
      )
    }
  }
}
