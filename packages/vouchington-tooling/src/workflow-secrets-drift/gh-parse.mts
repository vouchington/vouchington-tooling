import type { DeploymentBranchRule, EnvironmentDeploymentBranchPolicy } from './types.mts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function outputNames(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function parseSecretNames(stdout: string): string[] {
  return (JSON.parse(stdout) as Array<{ name: string }>).map((entry) => entry.name)
}

export function parseDeploymentBranchPolicy(
  stdout: string,
): Omit<EnvironmentDeploymentBranchPolicy, 'deploymentBranchRules'> {
  const parsed: unknown = JSON.parse(stdout)
  if (
    !isRecord(parsed) ||
    typeof parsed.protected_branches !== 'boolean' ||
    typeof parsed.custom_branch_policies !== 'boolean'
  ) {
    throw new Error('unexpected deployment branch policy metadata')
  }
  return {
    protectedBranchesEnabled: parsed.protected_branches,
    customBranchPoliciesEnabled: parsed.custom_branch_policies,
  }
}

export function parseDeploymentBranchRules(stdout: string): DeploymentBranchRule[] {
  const parsed: unknown = JSON.parse(stdout)
  const invalid = new Error('unexpected deployment branch policy')
  if (!isRecord(parsed)) throw invalid
  const { total_count, branch_policies } = parsed
  if (
    !Number.isSafeInteger(total_count) ||
    !Array.isArray(branch_policies) ||
    branch_policies.length > 2 ||
    branch_policies.length !== total_count
  ) {
    throw invalid
  }
  return branch_policies.map((rule: unknown) => {
    if (!isRecord(rule) || typeof rule.name !== 'string' || typeof rule.type !== 'string') {
      throw invalid
    }
    return { name: rule.name, type: rule.type }
  })
}
