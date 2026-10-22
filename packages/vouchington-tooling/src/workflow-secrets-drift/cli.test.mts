import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runVerifyWorkflowSecretsCli } from './cli.mts'
import { collectLiveSecretNames } from './collect.mts'
import { DEFAULT_INVENTORY_PATH, loadInventory, normalizeInventory } from './inventory.mts'
import type {
  EnvironmentDeploymentBranchPolicy,
  WorkflowSecretInventory,
  WorkflowSecretsDependencies,
} from './types.mts'

const goodPolicy: EnvironmentDeploymentBranchPolicy = {
  protectedBranchesEnabled: false,
  customBranchPoliciesEnabled: true,
  deploymentBranchRules: [{ name: 'main', type: 'branch' }],
}

const inventory: WorkflowSecretInventory = {
  TOKEN: { provisioned: true },
  LATER: { provisioned: false },
  DEPLOY: { provisioned: true, requiredEnvironment: 'prod' },
}

function deps(overrides: Partial<WorkflowSecretsDependencies> = {}): WorkflowSecretsDependencies {
  return {
    resolveRepo: async () => 'o/r',
    listRepoSecretNames: async () => ['TOKEN'],
    listRepositoryOwnerType: async () => 'Organization',
    listRepositoryOrganizationSecretNames: async () => [],
    listEnvironmentNames: async () => ['prod'],
    listEnvironmentSecretNames: async () => ['DEPLOY'],
    getEnvironmentDeploymentBranchPolicy: async () => goodPolicy,
    ...overrides,
  }
}

function capture() {
  const logs: string[] = []
  const errors: string[] = []
  return {
    logs,
    errors,
    output: {
      log: (value: string) => logs.push(value),
      error: (value: string) => errors.push(value),
    },
  }
}

describe('collectLiveSecretNames', () => {
  it('merges repository, organization and environment names', async () => {
    const live = await collectLiveSecretNames(
      'o/r',
      deps({ listRepositoryOrganizationSecretNames: async () => ['ORG'] }),
      new Set(['prod']),
    )
    expect([...live.names].toSorted()).toEqual(['DEPLOY', 'ORG', 'TOKEN'])
    expect(live.warnings).toEqual([])
    expect(live.environmentDeploymentBranchPolicies.get('prod')).toEqual(goodPolicy)
  })

  it('skips organization secrets for user-owned repositories', async () => {
    const live = await collectLiveSecretNames(
      'o/r',
      deps({
        listRepositoryOwnerType: async () => 'User',
        listRepositoryOrganizationSecretNames: async () => {
          throw new Error('not called')
        },
      }),
      new Set(),
    )
    expect(live.organizationNames.size).toBe(0)
    expect(live.warnings).toEqual([])
  })

  it('turns read failures into warnings', async () => {
    const live = await collectLiveSecretNames(
      'o/r',
      deps({
        listRepositoryOwnerType: async () => 'Bot',
        listEnvironmentNames: async () => ['a', 'b'],
        listEnvironmentSecretNames: async (_repo, environment) => {
          if (environment === 'a') throw new Error('denied')
          return ['B1']
        },
        getEnvironmentDeploymentBranchPolicy: async () => {
          throw 'gone'
        },
      }),
      new Set(['prod']),
    )
    expect(live.warnings).toEqual([
      'Could not list organization secrets for o/r: unexpected repository owner type: Bot',
      'Could not list secrets for environment "a": denied',
      'Could not list deployment branch policy for environment "prod": gone',
    ])
    expect(live.environmentNames.get('b')).toEqual(new Set(['B1']))

    const noEnvironments = await collectLiveSecretNames(
      'o/r',
      deps({
        listEnvironmentNames: async () => {
          throw new Error('forbidden')
        },
      }),
      new Set(),
    )
    expect(noEnvironments.warnings).toEqual([
      'Could not list deployment environments for o/r: forbidden',
    ])
  })
})

describe('runVerifyWorkflowSecretsCli', () => {
  it('passes when the store matches the inventory', async () => {
    const { logs, output } = capture()
    const code = await runVerifyWorkflowSecretsCli(['--confirm', ' TOKEN, ,'], {
      dependencies: deps(),
      inventory,
      output,
    })
    expect(code).toBe(0)
    expect(logs.join('\n')).toContain('Confirmed all 1 --confirm secret(s) are live.')
  })

  it('fails on drift, scope violations and unmet --confirm', async () => {
    const { logs, output } = capture()
    const code = await runVerifyWorkflowSecretsCli(
      ['--repo', 'x/y', '--confirm', 'NOPE', '--branch', 'release'],
      {
        dependencies: deps({ listRepoSecretNames: async () => ['LATER', 'EXTRA'] }),
        inventory,
        output,
      },
    )
    expect(code).toBe(1)
    const text = logs.join('\n')
    expect(text).toContain('  - LATER')
    expect(text).toContain('  - TOKEN')
    expect(text).toContain('Secret scope violations:')
    expect(text).toContain('only release')
    expect(text).toContain('gh does not see them: NOPE')
  })

  it('compares names case-insensitively and tolerates unprovisioned scoped secrets', async () => {
    const { output } = capture()
    const code = await runVerifyWorkflowSecretsCli(['--confirm', 'token'], {
      dependencies: deps({
        listRepoSecretNames: async () => ['token'],
        listEnvironmentNames: async () => ['Prod'],
        listEnvironmentSecretNames: async () => [],
      }),
      inventory: {
        Token: { provisioned: true },
        Deploy: { provisioned: false, requiredEnvironment: 'PROD' },
      },
      output,
    })
    expect(code).toBe(0)
  })

  it('rejects empty option values with exit code 2', async () => {
    for (const flag of ['repo', 'inventory', 'export', 'branch', 'confirm']) {
      const { errors, output } = capture()
      expect(await runVerifyWorkflowSecretsCli([`--${flag}`, ' '], { inventory, output })).toBe(2)
      expect(errors[0]).toContain(`--${flag} requires a non-empty value`)
    }
  })

  it('reports usage errors with exit code 2', async () => {
    const { errors, output } = capture()
    expect(await runVerifyWorkflowSecretsCli(['--bogus'], { output })).toBe(2)
    expect(errors[0]).toContain('Usage: vouchington verify-workflow-secrets')
  })

  it('reports runtime failures with exit code 1', async () => {
    const { errors, output } = capture()
    const code = await runVerifyWorkflowSecretsCli([], {
      dependencies: deps({
        resolveRepo: async () => {
          throw new Error('no repo')
        },
      }),
      inventory,
      output,
    })
    expect(code).toBe(1)
    expect(errors).toEqual(['verify-workflow-secrets failed: no repo'])
  })
})

describe('loadInventory', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'secrets-drift-'))
    mkdirSync(join(dir, '.github/workflows'), { recursive: true })
    writeFileSync(
      join(dir, DEFAULT_INVENTORY_PATH),
      'export const SECRET_INVENTORY = { A: { provisioned: true }, B: { provisioned: false } }\n' +
        'export const CUSTOM = { C: { provisioned: true } }\n' +
        'export const LISTY = []\n' +
        'export const BAD_ENTRY = { D: { provisioned: 1 }, }\n' +
        'export const NULL_ENTRY = { E: null }\n' +
        'export const BAD_FLAG = { F: { provisioned: true, neverProvision: "false" } }\n' +
        'export const BAD_SCOPE = { G: { provisioned: true, requiredEnvironment: 1 } }\n' +
        'export const NEVER_SCOPED = { H: { provisioned: false, neverProvision: true, requiredBranchPolicy: "x" } }\n' +
        'export const BOTH_SCOPES = { I: { provisioned: true, requiredEnvironment: "x", requiredBranchPolicy: "y" } }\n',
    )
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('loads the default and a named export relative to cwd', async () => {
    expect(
      Object.keys(await loadInventory(DEFAULT_INVENTORY_PATH, 'SECRET_INVENTORY', dir)),
    ).toEqual(['A', 'B'])
    expect(Object.keys(await loadInventory(join(dir, DEFAULT_INVENTORY_PATH), 'CUSTOM'))).toEqual([
      'C',
    ])
  })

  it('rejects missing exports and malformed entries', async () => {
    const load = (name: string) => loadInventory(DEFAULT_INVENTORY_PATH, name, dir)
    await expect(load('MISSING')).rejects.toThrow('must export an object named MISSING')
    await expect(load('LISTY')).rejects.toThrow('must export an object named LISTY')
    await expect(load('BAD_ENTRY')).rejects.toThrow('BAD_ENTRY.D must have a boolean provisioned')
    await expect(load('NULL_ENTRY')).rejects.toThrow('NULL_ENTRY.E must be an object')
    await expect(load('BAD_FLAG')).rejects.toThrow('BAD_FLAG.F neverProvision must be a boolean')
    await expect(load('BAD_SCOPE')).rejects.toThrow(
      'BAD_SCOPE.G requiredEnvironment must be a string',
    )
    await expect(load('NEVER_SCOPED')).rejects.toThrow('cannot be combined with a required scope')
    await expect(load('BOTH_SCOPES')).rejects.toThrow('mutually exclusive')
  })

  it('rejects names that collide after normalization', () => {
    expect(() =>
      normalizeInventory({ token: { provisioned: true }, TOKEN: { provisioned: false } }),
    ).toThrow('collide after normalization: TOKEN')
  })

  it('normalizes secret names to upper-case and environments to lower-case', () => {
    expect(
      normalizeInventory({
        token: { provisioned: true },
        Deploy: { provisioned: true, requiredEnvironment: 'Prod' },
        Hook: { provisioned: true, requiredBranchPolicy: 'Gate' },
      }),
    ).toEqual({
      TOKEN: { provisioned: true },
      DEPLOY: { provisioned: true, requiredEnvironment: 'prod' },
      HOOK: { provisioned: true, requiredBranchPolicy: 'gate' },
    })
  })

  it('loads the inventory from disk through the CLI', async () => {
    const { logs, output } = capture()
    const code = await runVerifyWorkflowSecretsCli(['--export', 'CUSTOM'], {
      dependencies: deps({
        listRepoSecretNames: async () => ['C'],
        listEnvironmentNames: async () => [],
      }),
      cwd: dir,
      output,
    })
    expect(code).toBe(0)
    const absolute = await runVerifyWorkflowSecretsCli(
      ['--inventory', join(dir, DEFAULT_INVENTORY_PATH), '--export', 'CUSTOM'],
      {
        dependencies: deps({
          listRepoSecretNames: async () => ['C'],
          listEnvironmentNames: async () => [],
        }),
        output,
      },
    )
    expect(absolute).toBe(0)
    expect(logs[0]).toContain('No drift')
  })
})
