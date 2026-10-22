import { errorMessage, settleLimited } from './settle.mts'
import type { EnvironmentDeploymentBranchPolicy, WorkflowSecretsDependencies } from './types.mts'

const QUERY_CONCURRENCY = 5

export interface LiveSecretNames {
  names: Set<string>
  repositoryNames: Set<string>
  organizationNames: Set<string>
  environmentNames: Map<string, Set<string>>
  environmentDeploymentBranchPolicies: Map<string, EnvironmentDeploymentBranchPolicy>
  warnings: string[]
}

/** GitHub stores secret names upper-case and compares them case-insensitively. */
const upperCased = (names: readonly string[]): Set<string> =>
  new Set(names.map((name) => name.toUpperCase()))

async function collectOrganizationNames(
  repo: string,
  dependencies: WorkflowSecretsDependencies,
  warnings: string[],
): Promise<Set<string>> {
  try {
    const ownerType = await dependencies.listRepositoryOwnerType(repo)
    if (ownerType !== 'Organization' && ownerType !== 'User') {
      throw new Error(`unexpected repository owner type: ${ownerType}`)
    }
    if (ownerType === 'User') return new Set()
    return upperCased(await dependencies.listRepositoryOrganizationSecretNames(repo))
  } catch (err) {
    warnings.push(`Could not list organization secrets for ${repo}: ${errorMessage(err)}`)
    return new Set()
  }
}

async function collectEnvironmentNames(
  repo: string,
  dependencies: WorkflowSecretsDependencies,
  warnings: string[],
): Promise<Map<string, Set<string>>> {
  let environments: string[] = []
  try {
    environments = await dependencies.listEnvironmentNames(repo)
  } catch (err) {
    warnings.push(`Could not list deployment environments for ${repo}: ${errorMessage(err)}`)
  }
  const results = await settleLimited(environments, QUERY_CONCURRENCY, (environment) =>
    dependencies.listEnvironmentSecretNames(repo, environment),
  )
  const byEnvironment = new Map<string, Set<string>>()
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      byEnvironment.set(environments[index]!.toLowerCase(), upperCased(result.value))
      return
    }
    warnings.push(
      `Could not list secrets for environment "${environments[index]}": ${errorMessage(result.reason)}`,
    )
  })
  return byEnvironment
}

async function collectBranchPolicies(
  repo: string,
  environments: ReadonlySet<string>,
  dependencies: WorkflowSecretsDependencies,
  warnings: string[],
): Promise<Map<string, EnvironmentDeploymentBranchPolicy>> {
  const names = [...environments]
  const results = await settleLimited(names, QUERY_CONCURRENCY, (environment) =>
    dependencies.getEnvironmentDeploymentBranchPolicy(repo, environment),
  )
  const policies = new Map<string, EnvironmentDeploymentBranchPolicy>()
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      policies.set(names[index]!, result.value)
      return
    }
    warnings.push(
      `Could not list deployment branch policy for environment "${names[index]}": ${errorMessage(result.reason)}`,
    )
  })
  return policies
}

export async function collectLiveSecretNames(
  repo: string,
  dependencies: WorkflowSecretsDependencies,
  requiredPolicyEnvironments: ReadonlySet<string>,
): Promise<LiveSecretNames> {
  const warnings: string[] = []
  const repositoryNames = upperCased(await dependencies.listRepoSecretNames(repo))
  const organizationNames = await collectOrganizationNames(repo, dependencies, warnings)
  const environmentNames = await collectEnvironmentNames(repo, dependencies, warnings)
  const environmentDeploymentBranchPolicies = await collectBranchPolicies(
    repo,
    requiredPolicyEnvironments,
    dependencies,
    warnings,
  )
  const names = new Set([...repositoryNames, ...organizationNames])
  for (const scoped of environmentNames.values()) for (const name of scoped) names.add(name)
  return {
    names,
    repositoryNames,
    organizationNames,
    environmentNames,
    environmentDeploymentBranchPolicies,
    warnings,
  }
}
