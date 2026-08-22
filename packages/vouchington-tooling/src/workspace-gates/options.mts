import {
  flattenReleaseAgeSelectors,
  type ReleaseAgeExemptionGroup,
} from '../pnpm-install/index.mts'

export interface WorkspaceGatesOptions {
  firstPartyNames: readonly string[]
  temporarySelectors?: readonly string[]
  temporaryGroups?: ReadonlyArray<ReleaseAgeExemptionGroup>
  /** Empty or omitted skips scoped-prefix discovery. */
  scopedPrefixes?: readonly string[]
  /** Default `pnpm-workspace.yaml`. */
  workspaceYamlPath?: string
  /** Default `.github/dependabot.yml`. */
  dependabotPath?: string
  /** Default `pnpm-lock.yaml`. */
  lockfilePath?: string
  /** Used in error messages. Default `first-party registry`. */
  firstPartyRegistryLabel?: string
}

export interface ResolvedWorkspaceGatesOptions {
  firstPartyNames: readonly string[]
  temporarySelectors: readonly string[]
  scopedPrefixes: readonly string[]
  workspaceYamlPath: string
  dependabotPath: string
  lockfilePath: string
  firstPartyRegistryLabel: string
}

export function resolveWorkspaceGatesOptions(
  options: WorkspaceGatesOptions,
): ResolvedWorkspaceGatesOptions {
  return {
    firstPartyNames: options.firstPartyNames,
    temporarySelectors:
      options.temporarySelectors ?? flattenReleaseAgeSelectors(options.temporaryGroups ?? []),
    scopedPrefixes: options.scopedPrefixes ?? [],
    workspaceYamlPath: options.workspaceYamlPath ?? 'pnpm-workspace.yaml',
    dependabotPath: options.dependabotPath ?? '.github/dependabot.yml',
    lockfilePath: options.lockfilePath ?? 'pnpm-lock.yaml',
    firstPartyRegistryLabel: options.firstPartyRegistryLabel ?? 'first-party registry',
  }
}

export function shouldValidateTemporaryGroups(options: WorkspaceGatesOptions): boolean {
  return options.temporaryGroups !== undefined && options.temporarySelectors === undefined
}
