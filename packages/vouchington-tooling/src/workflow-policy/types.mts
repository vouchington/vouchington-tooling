/** Structural input accepted from any GitHub Actions topology parser. */
export interface WorkflowStep {
  index: number
  id?: string
  uses?: string
  name?: string
  condition?: string
  env?: Record<string, string>
  run?: string
  secretReferences?: readonly string[]
}

interface WorkflowConcurrency {
  effective: {
    group: string
    cancelInProgress: boolean | string
    queue?: string
  }
}

export interface WorkflowNode {
  id: string
  path: string
  jobIds: readonly string[]
  callable?: boolean
  concurrency?: WorkflowConcurrency
  secretReferences?: readonly string[]
  workflowCall?: { secrets?: Record<string, { required?: boolean }> }
}

export interface WorkflowJobNode {
  id: string
  key: string
  workflowId: string
  steps: readonly WorkflowStep[]
  concurrency?: WorkflowConcurrency
  secretReferences?: readonly string[]
}

export interface WorkflowCallEdge {
  kind: string
  local?: boolean
  from: string
  to?: string
}

export interface WorkflowTopology {
  workflows: readonly WorkflowNode[]
  jobs: readonly WorkflowJobNode[]
  edges: readonly WorkflowCallEdge[]
}

export interface WorkflowTopologyIndex {
  jobsById: ReadonlyMap<string, WorkflowJobNode>
  workflowsByPath: ReadonlyMap<string, WorkflowNode>
  directDownstreamJobIds(id: string): readonly string[]
  transitiveDownstreamJobIds(id: string): readonly string[]
  directUpstreamJobIds(id: string): readonly string[]
  directCallerJobIds(path: string): readonly string[]
  artifactConsumersForProducerJob(id: string): readonly {
    to: string
    name: string
    match?: string
  }[]
}
