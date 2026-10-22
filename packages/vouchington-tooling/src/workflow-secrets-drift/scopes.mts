import type { EnvironmentDeploymentBranchPolicy, WorkflowSecretInventory } from './types.mts'

export function requiredEnvironmentNames(inventory: WorkflowSecretInventory): Set<string> {
  const names = new Set<string>()
  for (const entry of Object.values(inventory)) {
    if (entry.requiredEnvironment !== undefined) names.add(entry.requiredEnvironment)
    if (entry.requiredBranchPolicy !== undefined) names.add(entry.requiredBranchPolicy)
  }
  return names
}

export interface ScopeInput {
  repositoryNames: ReadonlySet<string>
  environmentNames: ReadonlyMap<string, ReadonlySet<string>>
  organizationNames: ReadonlySet<string>
  environmentDeploymentBranchPolicies: ReadonlyMap<string, EnvironmentDeploymentBranchPolicy>
  /** The only branch a required environment may deploy from. */
  deploymentBranch: string
}

function permitsOnlyBranch(
  policy: EnvironmentDeploymentBranchPolicy | undefined,
  branch: string,
): boolean {
  const [rule] = policy?.deploymentBranchRules ?? []
  return (
    policy?.protectedBranchesEnabled === false &&
    policy.customBranchPoliciesEnabled &&
    policy.deploymentBranchRules.length === 1 &&
    rule?.name === branch &&
    rule.type === 'branch'
  )
}

/** Names whose checked-in scope contract disagrees with the live secret metadata. */
export function requiredSecretScopeViolations(
  inventory: WorkflowSecretInventory,
  input: ScopeInput,
): string[] {
  const { repositoryNames, environmentNames, organizationNames } = input
  const violations: string[] = []
  const rejectOtherScopes = (name: string, keepEnvironment: string | undefined): void => {
    for (const [environment, names] of environmentNames) {
      if (environment !== keepEnvironment && names.has(name)) {
        violations.push(`${name} must not exist in environment ${environment}`)
      }
    }
    if (organizationNames.has(name)) {
      violations.push(`${name} must not exist as an organization secret`)
    }
  }
  for (const [name, entry] of Object.entries(inventory)) {
    if (entry.requiredEnvironment) {
      if (!environmentNames.get(entry.requiredEnvironment)?.has(name)) {
        violations.push(`${name} is missing from environment ${entry.requiredEnvironment}`)
      }
      if (repositoryNames.has(name))
        violations.push(`${name} must not exist as a repository secret`)
      rejectOtherScopes(name, entry.requiredEnvironment)
    } else if (entry.requiredBranchPolicy) {
      if (entry.provisioned && !repositoryNames.has(name)) {
        violations.push(`${name} is missing from repository secrets`)
      }
      rejectOtherScopes(name, undefined)
    }
  }
  for (const environment of requiredEnvironmentNames(inventory)) {
    const policy = input.environmentDeploymentBranchPolicies.get(environment)
    if (!permitsOnlyBranch(policy, input.deploymentBranch)) {
      violations.push(
        `environment ${environment} must permit deployments from only ${input.deploymentBranch}`,
      )
    }
  }
  return violations
}
