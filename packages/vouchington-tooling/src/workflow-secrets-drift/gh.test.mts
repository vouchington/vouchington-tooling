import { describe, expect, it } from 'vitest'

import { createGhDependencies } from './gh.mts'

function runner(replies: Record<string, string>) {
  const calls: string[][] = []
  const run = async (args: string[]): Promise<string> => {
    calls.push(args)
    const key = Object.keys(replies).find((candidate) => args.join(' ').includes(candidate))
    if (key === undefined) throw new Error(`unexpected gh ${args.join(' ')}`)
    return replies[key]!
  }
  return { calls, run }
}

describe('createGhDependencies', () => {
  it('reads names through gh', async () => {
    const { calls, run } = runner({
      'repo view': 'o/r\n',
      'secret list -R o/r --env e': '[{"name":"E1"}]',
      'secret list -R o/r --json': '[{"name":"A"},{"name":"B"}]',
      'repos/o/r --jq': 'Organization\n',
      'organization-secrets': 'O1\n\nO2\n',
      'o/r/environments --paginate': ' e \nf\n',
    })
    const deps = createGhDependencies(run)
    expect(await deps.resolveRepo()).toBe('o/r')
    expect(await deps.listRepoSecretNames('o/r')).toEqual(['A', 'B'])
    expect(await deps.listRepositoryOwnerType('o/r')).toBe('Organization')
    expect(await deps.listRepositoryOrganizationSecretNames('o/r')).toEqual(['O1', 'O2'])
    expect(await deps.listEnvironmentNames('o/r')).toEqual(['e', 'f'])
    expect(await deps.listEnvironmentSecretNames('o/r', 'e')).toEqual(['E1'])
    expect(calls).toHaveLength(6)
  })

  it('skips branch rules unless only custom policies are enabled', async () => {
    const { calls, run } = runner({
      'environments/a%2Fb --jq': '{"protected_branches":true,"custom_branch_policies":false}',
    })
    const policy = await createGhDependencies(run).getEnvironmentDeploymentBranchPolicy(
      'o/r',
      'a/b',
    )
    expect(policy).toEqual({
      protectedBranchesEnabled: true,
      customBranchPoliciesEnabled: false,
      deploymentBranchRules: [],
    })
    expect(calls).toHaveLength(1)
  })

  it('reads and validates custom branch rules', async () => {
    const policyJson = '{"protected_branches":false,"custom_branch_policies":true}'
    const rules = (value: unknown) =>
      runner({
        '--jq .deployment_branch_policy': policyJson,
        'deployment-branch-policies': JSON.stringify(value),
      })
    const read = (value: unknown) =>
      createGhDependencies(rules(value).run).getEnvironmentDeploymentBranchPolicy('o/r', 'e')

    await expect(
      read({ total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] }),
    ).resolves.toEqual({
      protectedBranchesEnabled: false,
      customBranchPoliciesEnabled: true,
      deploymentBranchRules: [{ name: 'main', type: 'branch' }],
    })
    const invalid = [
      [],
      { total_count: 'x', branch_policies: [] },
      { total_count: 1, branch_policies: 'nope' },
      { total_count: 3, branch_policies: [{}, {}, {}] },
      { total_count: 2, branch_policies: [{ name: 'a', type: 'branch' }] },
      { total_count: 1, branch_policies: [null] },
      { total_count: 1, branch_policies: [{ name: 1, type: 'branch' }] },
      { total_count: 1, branch_policies: [{ name: 'a', type: 2 }] },
    ]
    for (const value of invalid) {
      await expect(read(value)).rejects.toThrow('unexpected deployment branch policy')
    }
  })

  it('rejects malformed environment metadata', async () => {
    for (const body of [
      'null',
      '[]',
      '{"protected_branches":1,"custom_branch_policies":true}',
      '{"protected_branches":true}',
    ]) {
      const { run } = runner({ '--jq .deployment_branch_policy': body })
      await expect(
        createGhDependencies(run).getEnvironmentDeploymentBranchPolicy('o/r', 'e'),
      ).rejects.toThrow('unexpected deployment branch policy metadata')
    }
  })

  it('defaults to the shared gh runner', () => {
    expect(createGhDependencies().resolveRepo).toBeTypeOf('function')
  })
})
