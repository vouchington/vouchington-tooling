import { describe, expect, it } from 'vitest'

import { evaluateLockPolicy, type ConcurrencyPolicy } from './concurrency.mts'
import { evaluateGraphPolicy } from './graph.mts'
import { callerCalleePermissionMismatches } from './permission-mismatches.mts'
import { missingTopLevelPermissionPaths, parseWorkflow } from './permissions.mts'
import { unprovisionedSecretsWithoutReadinessStep } from './secret-readiness.mts'
import type { WorkflowTopology, WorkflowTopologyIndex, WorkflowTopologyPolicy } from './types.mts'

const callerPath = 'automation/release.yml'
const calleePath = 'automation/publish.yml'
const callerId = `${callerPath}#publish`
const calleeId = `${calleePath}#upload`

const guard = {
  index: 0,
  env: { RELEASE_KEY: '${{ secrets.RELEASE_KEY }}' },
  run: 'if [ -z "$RELEASE_KEY" ]; then echo missing; exit 1; fi',
  secretReferences: ['RELEASE_KEY'],
}

function topology(): WorkflowTopology {
  return {
    workflows: [
      { id: callerPath, path: callerPath, jobIds: [callerId] },
      { id: calleePath, path: calleePath, jobIds: [calleeId], callable: true },
    ],
    jobs: [
      { id: callerId, workflowId: callerPath, key: 'publish', steps: [] },
      {
        id: calleeId,
        workflowId: calleePath,
        key: 'upload',
        steps: [
          guard,
          { index: 1, condition: "vars.CHANNEL == 'stable'", secretReferences: ['RELEASE_KEY'] },
        ],
      },
    ],
    edges: [{ kind: 'calls', local: true, from: callerId, to: calleePath }],
  }
}

function index(input: WorkflowTopology): WorkflowTopologyIndex {
  return {
    jobsById: new Map(input.jobs.map((job) => [job.id, job])),
    workflowsByPath: new Map(input.workflows.map((workflow) => [workflow.path, workflow])),
    directDownstreamJobIds: (id) => (id === callerId ? [calleeId] : []),
    transitiveDownstreamJobIds: (id) => (id === callerId ? [calleeId] : []),
    directUpstreamJobIds: (id) => (id === calleeId ? [callerId] : []),
    directCallerJobIds: (path) => (path === calleePath ? [callerId] : []),
    artifactConsumersForProducerJob: (id) =>
      id === callerId ? [{ to: calleeId, name: 'build-output' }] : [],
  }
}

function policy(): WorkflowTopologyPolicy {
  return {
    jobInventory: { [callerPath]: ['publish'], [calleePath]: ['upload'] },
    requiredJobs: [callerId, calleeId],
    forbiddenJobs: [],
    requiredDirectEdges: [[callerId, calleeId]],
    forbiddenDirectEdges: [],
    requiredTransitiveEdges: [[callerId, calleeId]],
    forbiddenTransitiveEdges: [],
    requiredArtifactEdges: [{ from: callerId, to: calleeId, name: 'build-output' }],
    exactFanIns: { [calleeId]: [callerId] },
    exactCallerJobs: { [calleePath]: [callerId] },
    stepOrders: [{ jobId: calleeId, steps: [{ name: 'prepare' }, { name: 'publish' }] }],
  }
}

describe('consumer supplied workflow policies', () => {
  it('evaluates the graph, caller list, fan-in, artifact and step order', () => {
    const input = topology()
    input.jobs[1]!.steps[0]!.name = 'prepare'
    input.jobs[1]!.steps[1]!.name = 'publish'
    expect(evaluateGraphPolicy(input, index(input), policy())).toEqual([])

    const invalid = policy()
    invalid.forbiddenDirectEdges = [[callerId, calleeId]]
    invalid.requiredArtifactEdges = [{ from: callerId, to: calleeId, name: 'missing' }]
    invalid.exactCallerJobs = { [calleePath]: [] }
    invalid.stepOrders = [{ jobId: calleeId, steps: [{ name: 'publish' }, { name: 'prepare' }] }]
    expect(evaluateGraphPolicy(input, index(input), invalid)).toEqual(
      expect.arrayContaining([
        `forbidden direct edge present: ${callerId} -> ${calleeId}`,
        `required artifact edge missing: ${callerId} -> ${calleeId}: missing`,
        `caller allowlist mismatch: ${calleePath}: expected , got ${callerId}`,
        `required step order invalid: ${calleeId}: prepare`,
      ]),
    )
  })

  it('evaluates caller supplied concurrency intent and catches collisions', () => {
    const input = topology()
    input.workflows[0]!.concurrency = {
      effective: { group: '${{ github.ref }}', cancelInProgress: false, queue: 'single' },
    }
    input.workflows[1]!.concurrency = {
      effective: { group: '${{ github.ref }}', cancelInProgress: false, queue: 'single' },
    }
    const retained: ConcurrencyPolicy = {
      pending: 'coalesce-latest',
      cancellation: 'retain-running',
      scope: ['ref'],
    }
    expect(
      evaluateLockPolicy(input, {}, { [callerPath]: retained, [calleePath]: retained }),
    ).toContain(`concurrency group collision: ${'${{ github.ref }}'}: ${calleePath}, ${callerPath}`)
    input.workflows[1]!.concurrency = {
      effective: { group: '${{ github.sha }}', cancelInProgress: true, queue: 'max' },
    }
    expect(
      evaluateLockPolicy(input, {}, { [callerPath]: retained, [calleePath]: retained }),
    ).toEqual(
      expect.arrayContaining([
        `concurrency pending mismatch: ${calleePath}: expected coalesce-latest, got fifo`,
        `concurrency cancellation mismatch: ${calleePath}: expected retain-running, got cancel-running`,
        `concurrency scope mismatch: ${calleePath}: expected ref, got sha`,
      ]),
    )
  })

  it('requires an early guard in each secret consuming job and exempts optional contracts', () => {
    const input = topology()
    input.jobs[1]!.secretReferences = ['RELEASE_KEY']
    const inventory = { RELEASE_KEY: { provisioned: false } }
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toEqual([])
    input.jobs[1]!.steps[0]!.condition = "vars.CHANNEL == 'stable' && vars.EXTRA == 'true'"
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toHaveLength(1)
    input.workflows[1]!.workflowCall = { secrets: { RELEASE_KEY: { required: false } } }
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toEqual([])
  })

  it('compares reusable workflow permissions from supplied documents', () => {
    const documents = {
      [callerPath]: parseWorkflow(
        'on: push\njobs:\n  publish:\n    uses: ./publish.yml\n    permissions:\n      contents: read\n',
      ),
      [calleePath]: parseWorkflow(
        'on:\n  workflow_call:\npermissions:\n  contents: write\njobs:\n  upload:\n    runs-on: ubuntu-latest\n',
      ),
    }
    expect(missingTopLevelPermissionPaths(documents)).toEqual([callerPath])
    expect(callerCalleePermissionMismatches(topology(), documents)).toEqual([
      `  ${callerPath} job "publish" → ${calleePath}: caller grants {"contents":"read"}, callee requires {"contents":"write"}`,
    ])
    documents[callerPath].jobs!.publish!.permissions = { contents: 'write' }
    expect(callerCalleePermissionMismatches(topology(), documents)).toEqual([])
  })
})
