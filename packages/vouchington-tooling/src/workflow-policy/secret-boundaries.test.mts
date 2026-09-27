import { describe, expect, it } from 'vitest'

import { conditionEntails } from './condition-entailment.mts'
import { hasTopLevelMixedOperators, splitTopLevel } from './condition-split.mts'
import { unprovisionedSecretsWithoutReadinessStep } from './secret-readiness.mts'
import { stripShellComments } from './shell-comments.mts'
import type { WorkflowTopology } from './types.mts'

const path = 'ci/reusable.yml'
const key = 'DEPLOY_KEY'
const inventory = { [key]: { provisioned: false } }

function topology(stepScoped: boolean): WorkflowTopology {
  return {
    workflows: [{ id: path, path, jobIds: [`${path}#deploy`] }],
    jobs: [
      {
        id: `${path}#deploy`,
        workflowId: path,
        key: 'deploy',
        steps: [
          {
            index: 0,
            env: { CHECK: '${{ secrets.DEPLOY_KEY }}' },
            run: 'if [ -z "$CHECK" ]; then exit 1; fi',
          },
          { index: 1, run: 'publish', ...(stepScoped ? { secretReferences: [key] } : {}) },
        ],
        ...(stepScoped ? {} : { secretReferences: [key] }),
      },
    ],
    edges: [],
  }
}

describe('secret readiness boundaries', () => {
  it('honors step-scoped references without requiring an inventory singleton', () => {
    const input = topology(true)
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toEqual([])
    input.jobs[0]!.steps[0]!.index = 2
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toHaveLength(1)
    expect(
      unprovisionedSecretsWithoutReadinessStep(input, { [key]: { provisioned: true } }),
    ).toEqual([])
  })

  it('rejects shell comments posing as readiness and accepts quoted hash characters', () => {
    const input = topology(false)
    input.jobs[0]!.steps[0]!.run = 'if [ -z "$CHECK" ]; then echo missing; # exit 1\nfi'
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toHaveLength(1)
    input.jobs[0]!.steps[0]!.run = 'if [ -z "$CHECK" ]; then echo "missing # detail"; exit 1; fi'
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toEqual([])
    input.jobs[0]!.steps[0]!.run = 'echo unrelated; exit 1'
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toHaveLength(1)
    expect(stripShellComments("echo '# literal' # trailing\n# entire line")).toBe(
      "echo '# literal' \n",
    )
    expect(stripShellComments('echo artifact#tag # trailing')).toBe('echo artifact#tag ')
  })

  it('parses nested operators and quotes conservatively', () => {
    expect(splitTopLevel('vars.A && (vars.B || vars.C) && "a && b"', '&&')).toEqual([
      'vars.A',
      '(vars.B || vars.C)',
      '"a && b"',
    ])
    expect(splitTopLevel('&& vars.A &&', '&&')).toEqual(['vars.A'])
    expect(hasTopLevelMixedOperators('vars.A && (vars.B || vars.C)')).toBe(false)
    expect(hasTopLevelMixedOperators('vars.A && vars.B || vars.C')).toBe(true)
    expect(conditionEntails("vars.A == 'a && b'", "vars.A == 'a && b' && vars.C")).toBe(true)
    expect(conditionEntails('(vars.A || vars.B) && vars.C', 'vars.B && vars.C')).toBe(true)
    expect(conditionEntails('(vars.A) || (vars.B)', '(vars.A) || (vars.B)')).toBe(true)
    expect(conditionEntails('always() && success()', '')).toBe(false)
    expect(hasTopLevelMixedOperators('"a && b" || vars.C')).toBe(false)
  })

  it('does not invent job consumers from a workflow-only reference', () => {
    const input = topology(false)
    input.workflows[0]!.secretReferences = [key]
    input.jobs = []
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toEqual([])
  })

  it('does not mistake an unrelated env binding or a missing run for a readiness guard', () => {
    const input = topology(false)
    input.jobs[0]!.steps[0]!.env = {
      CHECK: '${{ secrets.DEPLOY_KEY }}',
      OTHER: 'plain text',
    }
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toEqual([])
    delete input.jobs[0]!.steps[0]!.run
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toHaveLength(1)
  })

  it('uses unresolved job workflow ids as paths and ignores unreferenced inventory entries', () => {
    const input = topology(false)
    input.jobs[0]!.workflowId = 'external/workflow.yml'
    input.jobs[0]!.steps[0]!.run = 'echo no guard'
    expect(
      unprovisionedSecretsWithoutReadinessStep(input, {
        ...inventory,
        UNUSED_KEY: { provisioned: false },
      }),
    ).toEqual([expect.stringMatching(/^external\/workflow\.yml: "DEPLOY_KEY" is unprovisioned/)])
  })
})
