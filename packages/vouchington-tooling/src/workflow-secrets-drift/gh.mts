import { runGh, type RunTextCommand } from '../gh-cli/index.mts'
import {
  outputNames,
  parseDeploymentBranchPolicy,
  parseDeploymentBranchRules,
  parseSecretNames,
} from './gh-parse.mts'
import type { WorkflowSecretsDependencies } from './types.mts'

/** Builds the live reads on top of an injectable `gh` runner (argv in, stdout out). */
export function createGhDependencies(run: RunTextCommand = runGh): WorkflowSecretsDependencies {
  return {
    resolveRepo: async () =>
      (await run(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])).trim(),
    listRepoSecretNames: async (repo) =>
      parseSecretNames(await run(['secret', 'list', '-R', repo, '--json', 'name'])),
    listRepositoryOwnerType: async (repo) =>
      (await run(['api', `repos/${repo}`, '--jq', '.owner.type'])).trim(),
    listRepositoryOrganizationSecretNames: async (repo) =>
      outputNames(
        await run([
          'api',
          `repos/${repo}/actions/organization-secrets`,
          '--paginate',
          '--jq',
          '.secrets[].name',
        ]),
      ),
    listEnvironmentNames: async (repo) =>
      outputNames(
        await run([
          'api',
          `repos/${repo}/environments`,
          '--paginate',
          '--jq',
          '.environments[].name',
        ]),
      ),
    listEnvironmentSecretNames: async (repo, environment) =>
      parseSecretNames(
        await run(['secret', 'list', '-R', repo, '--env', environment, '--json', 'name']),
      ),
    getEnvironmentDeploymentBranchPolicy: async (repo, environment) => {
      const endpoint = `repos/${repo}/environments/${encodeURIComponent(environment)}`
      const policy = parseDeploymentBranchPolicy(
        await run(['api', endpoint, '--jq', '.deployment_branch_policy']),
      )
      if (!policy.customBranchPoliciesEnabled || policy.protectedBranchesEnabled) {
        return { ...policy, deploymentBranchRules: [] }
      }
      const rules = await run([
        'api',
        '-X',
        'GET',
        `${endpoint}/deployment-branch-policies`,
        '-F',
        'per_page=2',
        '-F',
        'page=1',
        '--jq',
        '{total_count, branch_policies: [.branch_policies[] | {name, type}]}',
      ])
      return { ...policy, deploymentBranchRules: parseDeploymentBranchRules(rules) }
    },
  }
}
