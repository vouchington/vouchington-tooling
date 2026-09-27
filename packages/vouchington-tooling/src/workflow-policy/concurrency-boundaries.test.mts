import { describe, expect, it } from 'vitest'

import { extractConcurrencyScopes, normalizePolicyScopes } from './concurrency-scope.mts'
import { evaluateLockPolicy, type ConcurrencyPolicy } from './concurrency.mts'
import type { WorkflowTopology } from './types.mts'

const retained: ConcurrencyPolicy = {
  pending: 'coalesce-latest',
  cancellation: 'retain-running',
  scope: ['ref'],
}

function topology(group?: string): WorkflowTopology {
  return {
    workflows: [
      {
        id: 'automation/check.yml',
        path: 'automation/check.yml',
        jobIds: ['automation/check.yml#check'],
        ...(group === undefined
          ? {}
          : { concurrency: { effective: { group, cancelInProgress: false } } }),
      },
    ],
    jobs: [
      {
        id: 'automation/check.yml#check',
        workflowId: 'automation/check.yml',
        key: 'check',
        steps: [],
      },
    ],
    edges: [],
  }
}

describe('consumer supplied concurrency intent', () => {
  it('classifies each supported expression context and flags unknown contexts', () => {
    const group = [
      'github.workflow',
      'github.event.pull_request.number',
      'github.event.workflow_run.pull_requests',
      'github.event.pull_request.head.sha',
      'github.event.workflow_run.head_sha',
      'github.sha',
      'github.ref_name',
      'github.event.workflow_run.head_branch',
      'github.run_id',
      'github.event_name',
      'github.event.inputs',
      'inputs.resource',
      'github.unknown',
    ].join(' | ')
    expect(extractConcurrencyScopes(group)).toEqual([
      'pull-request',
      'ref',
      'sha',
      'run',
      'event',
      'input-resource',
      'unsupported:github.unknown',
    ])
    expect(normalizePolicyScopes(['sha', 'ref', 'ref'])).toEqual(['ref', 'sha'])
    expect(normalizePolicyScopes(['fixed-resource'])).toEqual([])
    expect(normalizePolicyScopes(['fixed-resource', 'ref'])).toEqual([
      'unsupported:fixed-resource-combination',
    ])
    expect(extractConcurrencyScopes('github.zeta | github.alpha')).toEqual([
      'unsupported:github.alpha',
      'unsupported:github.zeta',
    ])
  })

  it('requires intent for each owner and a reason for each unlocked workflow', () => {
    const unlocked = topology()
    expect(evaluateLockPolicy(unlocked, {}, {})).toContain(
      'lock intent missing: automation/check.yml',
    )
    expect(evaluateLockPolicy(unlocked, { 'automation/check.yml': '   ' }, {})).toContain(
      'unlocked reason empty: automation/check.yml',
    )
    expect(evaluateLockPolicy(unlocked, { 'other.yml': 'independent' }, {})).toContain(
      'unlocked reason stale: other.yml',
    )

    const locked = topology('${{ github.ref }}')
    expect(evaluateLockPolicy(locked, { 'automation/check.yml': 'obsolete' }, {})).toEqual(
      expect.arrayContaining([
        'lock intent missing: automation/check.yml',
        'unlocked reason stale: automation/check.yml',
      ]),
    )
    expect(evaluateLockPolicy(unlocked, {}, { 'automation/check.yml': retained })).toContain(
      'lock intent stale: automation/check.yml',
    )
  })

  it('checks malformed conditional cancellation and workflow-qualified collision groups', () => {
    const locked = topology('${{ github.ref }}')
    locked.workflows[0]!.concurrency!.effective.cancelInProgress = 'github.ref == main'
    expect(evaluateLockPolicy(locked, {}, { 'automation/check.yml': retained })).toContain(
      'conditional cancel-in-progress expression invalid: automation/check.yml: github.ref == main',
    )

    const grouped: WorkflowTopology = {
      workflows: [
        {
          id: 'workflow-one',
          path: 'automation/one.yml',
          jobIds: [],
          concurrency: {
            effective: {
              group: '${{ github.workflow }}-${{ github.ref }}',
              cancelInProgress: false,
            },
          },
        },
        {
          id: 'workflow-two',
          path: 'automation/two.yml',
          jobIds: [],
          concurrency: {
            effective: {
              group: '${{ github.workflow }}-${{ github.ref }}',
              cancelInProgress: false,
            },
          },
        },
      ],
      jobs: [],
      edges: [],
    }
    const reasons = {}
    const semantics = { 'workflow-one': retained, 'workflow-two': retained }
    expect(
      evaluateLockPolicy(grouped, reasons, semantics).some((item) =>
        item.startsWith('concurrency group collision:'),
      ),
    ).toBe(false)
    expect(
      evaluateLockPolicy(topology(''), {}, { 'automation/check.yml': retained }),
    ).not.toContain('concurrency group collision: : automation/check.yml')

    const jobGroup = '${{ github.workflow }}-${{ github.ref }}'
    const sameWorkflow: WorkflowTopology = {
      workflows: [{ id: 'workflow-id', path: 'automation/jobs.yml', jobIds: ['first', 'second'] }],
      jobs: [
        {
          id: 'first',
          workflowId: 'workflow-id',
          key: 'first',
          steps: [],
          concurrency: { effective: { group: jobGroup, cancelInProgress: false } },
        },
        {
          id: 'second',
          workflowId: 'workflow-id',
          key: 'second',
          steps: [],
          concurrency: { effective: { group: jobGroup, cancelInProgress: false } },
        },
      ],
      edges: [],
    }
    expect(evaluateLockPolicy(sameWorkflow, {}, { first: retained, second: retained })).toContain(
      `concurrency group collision: ${jobGroup}: first, second`,
    )
  })
})
