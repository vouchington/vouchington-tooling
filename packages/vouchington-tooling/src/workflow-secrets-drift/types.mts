import type { SecretInventoryEntry } from '../workflow-policy/secret-readiness.mts'

/**
 * One inventory entry. Extends the readiness inventory entry with the optional drift and scope
 * contracts. Only secret names and presence are ever read; values never leave the secret store.
 */
export interface WorkflowSecretInventoryEntry extends SecretInventoryEntry {
  /** Secret must live only in this environment, never as a repository, other-environment or organization secret. */
  readonly requiredEnvironment?: string
  /** Environment kept only for its deployment-branch gate while the secret itself is repository scoped. */
  readonly requiredBranchPolicy?: string
  /** Contract-only placeholder name that must never become a real secret. */
  readonly neverProvision?: boolean
}

export type WorkflowSecretInventory = Readonly<Record<string, WorkflowSecretInventoryEntry>>

export interface DeploymentBranchRule {
  name: string
  type: string
}

export interface EnvironmentDeploymentBranchPolicy {
  protectedBranchesEnabled: boolean
  customBranchPoliciesEnabled: boolean
  deploymentBranchRules: DeploymentBranchRule[]
}

/** Live secret-store reads. Every method returns names or metadata, never secret values. */
export interface WorkflowSecretsDependencies {
  resolveRepo: () => Promise<string>
  listRepoSecretNames: (repo: string) => Promise<string[]>
  listRepositoryOwnerType: (repo: string) => Promise<string>
  listRepositoryOrganizationSecretNames: (repo: string) => Promise<string[]>
  listEnvironmentNames: (repo: string) => Promise<string[]>
  listEnvironmentSecretNames: (repo: string, environment: string) => Promise<string[]>
  getEnvironmentDeploymentBranchPolicy: (
    repo: string,
    environment: string,
  ) => Promise<EnvironmentDeploymentBranchPolicy>
}
