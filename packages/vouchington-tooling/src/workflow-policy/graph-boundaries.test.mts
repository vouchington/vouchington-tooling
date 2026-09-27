import { describe, expect, it } from 'vitest'

import { evaluateGraphPolicy } from './graph.mts'
import type { WorkflowTopology, WorkflowTopologyIndex, WorkflowTopologyPolicy } from './types.mts'

const producer = 'pipelines/build.yml#compile'
const consumer = 'pipelines/publish.yml#ship'
const callablePath = 'pipelines/publish.yml'

function fixture() {
  const topology: WorkflowTopology = {
    workflows: [
      { id: 'pipelines/build.yml', path: 'pipelines/build.yml', jobIds: [producer] },
      { id: callablePath, path: callablePath, jobIds: [consumer], callable: true },
    ],
    jobs: [
      { id: producer, workflowId: 'pipelines/build.yml', key: 'compile', steps: [] },
      { id: consumer, workflowId: callablePath, key: 'ship', steps: [{ index: 0, id: 'prepare' }] },
    ],
    edges: [],
  }
  const index: WorkflowTopologyIndex = {
    jobsById: new Map(topology.jobs.map((job) => [job.id, job])),
    workflowsByPath: new Map(topology.workflows.map((workflow) => [workflow.path, workflow])),
    directDownstreamJobIds: (id) => (id === producer ? [consumer] : []),
    transitiveDownstreamJobIds: (id) => (id === producer ? [consumer] : []),
    directUpstreamJobIds: (id) => (id === consumer ? [producer] : []),
    directCallerJobIds: (path) => (path === callablePath ? [producer] : []),
    artifactConsumersForProducerJob: (id) =>
      id === producer ? [{ to: consumer, name: 'bundle', match: 'exact' }] : [],
  }
  const policy: WorkflowTopologyPolicy = {
    jobInventory: { 'pipelines/build.yml': ['compile'], [callablePath]: ['ship'] },
    requiredJobs: [],
    forbiddenJobs: [],
    requiredDirectEdges: [],
    forbiddenDirectEdges: [],
    requiredTransitiveEdges: [],
    forbiddenTransitiveEdges: [],
    requiredArtifactEdges: [],
    exactFanIns: {},
    exactCallerJobs: { [callablePath]: [producer] },
    stepOrders: [],
  }
  return { topology, index, policy }
}

describe('topology policy failures', () => {
  it('reports missing, stale, and mismatched inventory and job presence', () => {
    const { topology, index, policy } = fixture()
    policy.jobInventory = { 'pipelines/build.yml': ['different'], 'pipelines/gone.yml': ['old'] }
    policy.requiredJobs = ['missing#job']
    policy.forbiddenJobs = [producer]
    expect(evaluateGraphPolicy(topology, index, policy)).toEqual(
      expect.arrayContaining([
        'workflow inventory missing: pipelines/publish.yml',
        'workflow inventory stale: pipelines/gone.yml',
        'job inventory mismatch: pipelines/build.yml: expected different, got compile',
        'required job missing: missing#job',
        `forbidden job present: ${producer}`,
      ]),
    )
  })

  it('distinguishes missing endpoints from missing graph edges', () => {
    const { topology, index, policy } = fixture()
    policy.requiredDirectEdges = [
      [producer, 'missing#job'],
      [consumer, producer],
    ]
    policy.forbiddenDirectEdges = [
      [producer, consumer],
      [producer, 'missing#job'],
    ]
    policy.requiredTransitiveEdges = [
      [consumer, producer],
      [producer, 'missing#job'],
    ]
    policy.forbiddenTransitiveEdges = [[producer, consumer]]
    policy.requiredArtifactEdges = [
      { from: producer, to: consumer, name: 'bundle', match: 'pattern' },
      { from: producer, to: 'missing#job', name: 'bundle' },
    ]
    expect(evaluateGraphPolicy(topology, index, policy)).toEqual(
      expect.arrayContaining([
        `required direct edge missing: ${producer} -> missing#job`,
        `required direct edge missing: ${consumer} -> ${producer}`,
        `forbidden transitive edge present: ${producer} -> ${consumer}`,
        `required artifact edge missing: ${producer} -> ${consumer}: bundle [pattern]`,
        `required artifact edge missing: ${producer} -> missing#job: bundle`,
      ]),
    )
  })

  it('checks fan-in, caller inventory, and ordered steps', () => {
    const { topology, index, policy } = fixture()
    policy.exactFanIns = { [consumer]: [], 'missing#job': [] }
    policy.exactCallerJobs = { 'pipelines/obsolete.yml': [producer] }
    policy.stepOrders = [
      { jobId: consumer, steps: [{ id: 'absent' }] },
      { jobId: 'missing#job', steps: [{ id: 'prepare' }] },
    ]
    expect(evaluateGraphPolicy(topology, index, policy)).toEqual(
      expect.arrayContaining([
        `exact fan-in mismatch: ${consumer}: expected , got ${producer}`,
        'exact fan-in target missing: missing#job',
        `caller allowlist missing: ${callablePath}`,
        'caller allowlist stale: pipelines/obsolete.yml',
        `required ordered step missing: ${consumer}: absent`,
        'step-order job missing: missing#job',
      ]),
    )
  })

  it('sorts multiple jobs and callable workflows before comparing declared inventory', () => {
    const { topology, index, policy } = fixture()
    const secondJob = 'opaque-build-job'
    const thirdPath = 'pipelines/verify.yml'
    const expanded: WorkflowTopology = {
      workflows: [
        { ...topology.workflows[0]!, jobIds: [producer, secondJob] },
        topology.workflows[1]!,
        { id: thirdPath, path: thirdPath, jobIds: [], callable: true },
      ],
      jobs: [
        ...topology.jobs,
        { id: secondJob, workflowId: 'pipelines/build.yml', key: 'assemble', steps: [] },
      ],
      edges: [],
    }
    policy.jobInventory = {
      ...policy.jobInventory,
      'pipelines/build.yml': ['assemble', 'compile'],
      [thirdPath]: [],
    }
    policy.exactCallerJobs = { ...policy.exactCallerJobs, [thirdPath]: [] }
    policy.exactFanIns = { [consumer]: [secondJob, producer] }
    policy.exactCallerJobs = { ...policy.exactCallerJobs, [callablePath]: [secondJob, producer] }
    const expandedIndex: WorkflowTopologyIndex = {
      ...index,
      workflowsByPath: new Map(expanded.workflows.map((workflow) => [workflow.path, workflow])),
      jobsById: new Map(expanded.jobs.map((job) => [job.id, job])),
      directUpstreamJobIds: (id) => (id === consumer ? [producer, secondJob] : []),
      directCallerJobIds: (path) => (path === callablePath ? [producer, secondJob] : []),
    }
    expect(evaluateGraphPolicy(expanded, expandedIndex, policy)).toEqual([])
  })
})
