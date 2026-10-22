import { describe, expect, it } from 'vitest'

import {
  diffAgainstInventory,
  formatDrift,
  missingConfirmedSecrets,
  unconfirmedNewlyProvisioned,
} from './drift.mts'
import { requiredEnvironmentNames, requiredSecretScopeViolations } from './scopes.mts'
import { settleLimited } from './settle.mts'
import type { EnvironmentDeploymentBranchPolicy, WorkflowSecretInventory } from './types.mts'

const inventory: WorkflowSecretInventory = {
  ALPHA: { provisioned: true },
  BETA: { provisioned: false },
  GAMMA: { provisioned: true },
  PLACEHOLDER: { provisioned: false, neverProvision: true },
  QUIET: { provisioned: false, neverProvision: true },
  SYNCED: { provisioned: false },
}

describe('diffAgainstInventory', () => {
  it('classifies every drift kind and sorts names', () => {
    const drift = diffAgainstInventory(
      inventory,
      new Set(['ZED', 'ALPHA', 'BETA', 'PLACEHOLDER', 'EXTRA']),
      ['careful'],
    )
    expect(drift).toEqual({
      newlyProvisioned: ['BETA'],
      notActuallyProvisioned: ['GAMMA'],
      accidentallyProvisioned: ['PLACEHOLDER'],
      unreferenced: ['EXTRA', 'ZED'],
      warnings: ['careful'],
    })
  })

  it('formats each section, warnings, and the clean state', () => {
    const text = formatDrift(
      diffAgainstInventory(inventory, new Set(['BETA', 'PLACEHOLDER', 'EXTRA']), ['w']),
    )
    expect(text).toContain('  - BETA')
    expect(text).toContain('  - GAMMA')
    expect(text).toContain('  - PLACEHOLDER')
    expect(text).toContain('  - EXTRA')
    expect(text).toContain('Warning: w')
    expect(
      formatDrift(diffAgainstInventory({ A: { provisioned: true } }, new Set(['A']), [])),
    ).toBe('The inventory matches the live secret store. No drift.\n')
  })

  it('checks --confirm names against live names', () => {
    const drift = diffAgainstInventory(inventory, new Set(['BETA', 'SYNCED']), [])
    expect(missingConfirmedSecrets(['BETA', 'MISSING'], new Set(['BETA']))).toEqual(['MISSING'])
    expect(unconfirmedNewlyProvisioned(drift, ['BETA'])).toEqual(['SYNCED'])
  })
})

const goodPolicy: EnvironmentDeploymentBranchPolicy = {
  protectedBranchesEnabled: false,
  customBranchPoliciesEnabled: true,
  deploymentBranchRules: [{ name: 'main', type: 'branch' }],
}

const scoped: WorkflowSecretInventory = {
  ENV_ONLY: { provisioned: true, requiredEnvironment: 'prod' },
  REPO_ONLY: { provisioned: true, requiredBranchPolicy: 'gate' },
  PENDING: { provisioned: false, requiredBranchPolicy: 'gate' },
  PLAIN: { provisioned: true },
}

function violations(
  overrides: Partial<Parameters<typeof requiredSecretScopeViolations>[1]> = {},
): string[] {
  return requiredSecretScopeViolations(scoped, {
    repositoryNames: new Set(['REPO_ONLY']),
    environmentNames: new Map([['prod', new Set(['ENV_ONLY'])]]),
    organizationNames: new Set(),
    environmentDeploymentBranchPolicies: new Map([
      ['prod', goodPolicy],
      ['gate', goodPolicy],
    ]),
    deploymentBranch: 'main',
    ...overrides,
  })
}

describe('requiredSecretScopeViolations', () => {
  it('collects environment names from both contracts', () => {
    expect([...requiredEnvironmentNames(scoped)].toSorted()).toEqual(['gate', 'prod'])
  })

  it('accepts a conforming store', () => {
    expect(violations()).toEqual([])
  })

  it('rejects stray scopes for an environment-only secret', () => {
    expect(
      violations({
        repositoryNames: new Set(['REPO_ONLY', 'ENV_ONLY']),
        environmentNames: new Map([
          ['prod', new Set<string>()],
          ['other', new Set(['ENV_ONLY'])],
        ]),
        organizationNames: new Set(['ENV_ONLY']),
      }),
    ).toEqual([
      'ENV_ONLY is missing from environment prod',
      'ENV_ONLY must not exist as a repository secret',
      'ENV_ONLY must not exist in environment other',
      'ENV_ONLY must not exist as an organization secret',
    ])
  })

  it('requires a branch-policy secret to be repository scoped only', () => {
    expect(
      violations({
        repositoryNames: new Set(),
        environmentNames: new Map([
          ['gate', new Set(['REPO_ONLY', 'PENDING'])],
          ['prod', new Set(['ENV_ONLY'])],
        ]),
        organizationNames: new Set(['REPO_ONLY']),
      }),
    ).toEqual([
      'REPO_ONLY is missing from repository secrets',
      'REPO_ONLY must not exist in environment gate',
      'REPO_ONLY must not exist as an organization secret',
      'PENDING must not exist in environment gate',
    ])
  })

  it('requires exactly the configured deployment branch', () => {
    const bad = (policy: EnvironmentDeploymentBranchPolicy | undefined) =>
      violations({
        environmentDeploymentBranchPolicies: new Map(
          policy
            ? [
                ['prod', policy],
                ['gate', goodPolicy],
              ]
            : [['gate', goodPolicy]],
        ),
      })
    const expected = ['environment prod must permit deployments from only main']
    expect(bad(undefined)).toEqual(expected)
    expect(bad({ ...goodPolicy, protectedBranchesEnabled: true })).toEqual(expected)
    expect(bad({ ...goodPolicy, customBranchPoliciesEnabled: false })).toEqual(expected)
    expect(bad({ ...goodPolicy, deploymentBranchRules: [] })).toEqual(expected)
    expect(
      bad({ ...goodPolicy, deploymentBranchRules: [{ name: 'dev', type: 'branch' }] }),
    ).toEqual(expected)
    expect(bad({ ...goodPolicy, deploymentBranchRules: [{ name: 'main', type: 'tag' }] })).toEqual(
      expected,
    )
    expect(violations({ deploymentBranch: 'release' })).toEqual([
      'environment prod must permit deployments from only release',
      'environment gate must permit deployments from only release',
    ])
  })
})

describe('settleLimited', () => {
  it('keeps order, captures rejections, and bounds concurrency', async () => {
    let inFlight = 0
    let peak = 0
    const results = await settleLimited([1, 2, 3, 4, 5], 2, async (value) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      if (value === 3) throw new Error('three')
      return value * 2
    })
    expect(peak).toBe(2)
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'rejected',
      'fulfilled',
      'fulfilled',
    ])
    expect(results[4]).toEqual({ status: 'fulfilled', value: 10 })
    expect(await settleLimited([], 5, async () => 1)).toEqual([])
  })
})
