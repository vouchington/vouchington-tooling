import { validateReleaseAgeExemptionGroups } from '../pnpm-install/index.mts'
import type { SharedContext } from '../shared-context/index.mts'
import { checkDependabotCrosslist } from './dependabot.mts'
import { checkExcludeRegistry } from './exclude-registry.mts'
import {
  checkActiveFirstPartyGraph,
  checkTemporaryReleaseAgeSelectorsInLockfile,
} from './first-party-graph.mts'
import {
  resolveWorkspaceGatesOptions,
  shouldValidateTemporaryGroups,
  type WorkspaceGatesOptions,
} from './options.mts'
import { loadYaml } from './yaml-loader.mts'

export async function checkWorkspaceGatesPolicy(
  ctx: SharedContext,
  options: WorkspaceGatesOptions,
): Promise<{ errors: string[] }> {
  const errors: string[] = []
  const resolved = resolveWorkspaceGatesOptions(options)

  if (shouldValidateTemporaryGroups(options) && options.temporaryGroups !== undefined) {
    for (const error of validateReleaseAgeExemptionGroups(options.temporaryGroups)) {
      errors.push(`::error::${error}`)
    }
  }

  const workspace = await loadYaml(ctx.repoRoot, resolved.workspaceYamlPath, errors)
  if (!workspace) return { errors }

  checkExcludeRegistry(workspace, errors, resolved)
  const [, , dependabot] = await Promise.all([
    checkActiveFirstPartyGraph(ctx, errors, resolved),
    checkTemporaryReleaseAgeSelectorsInLockfile(
      ctx,
      errors,
      resolved.temporarySelectors,
      resolved.lockfilePath,
    ),
    loadYaml(ctx.repoRoot, resolved.dependabotPath, errors),
  ])
  if (dependabot) checkDependabotCrosslist(dependabot, errors, resolved)

  return { errors }
}
