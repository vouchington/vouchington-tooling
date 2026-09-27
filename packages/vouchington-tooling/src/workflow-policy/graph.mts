import type {
  EdgeRule,
  StepSelector,
  WorkflowTopology,
  WorkflowTopologyIndex,
  WorkflowTopologyPolicy,
} from './types.mts'

export function evaluateGraphPolicy(
  topology: WorkflowTopology,
  index: WorkflowTopologyIndex,
  policy: WorkflowTopologyPolicy,
): string[] {
  const diagnostics = [
    ...inventoryDiagnostics(topology, policy),
    ...jobPresenceDiagnostics(index, policy),
    ...edgeDiagnostics(index, policy.requiredDirectEdges, true, true),
    ...edgeDiagnostics(index, policy.forbiddenDirectEdges, true, false),
    ...edgeDiagnostics(index, policy.requiredTransitiveEdges, false, true),
    ...edgeDiagnostics(index, policy.forbiddenTransitiveEdges, false, false),
    ...artifactEdgeDiagnostics(index, policy),
    ...fanInDiagnostics(index, policy),
    ...callerDiagnostics(index, policy),
    ...stepOrderDiagnostics(index, policy),
  ]
  return diagnostics.toSorted()
}

function artifactEdgeDiagnostics(
  index: WorkflowTopologyIndex,
  policy: WorkflowTopologyPolicy,
): string[] {
  return policy.requiredArtifactEdges.flatMap((rule) => {
    const label = `${rule.from} -> ${rule.to}: ${rule.name}${rule.match ? ` [${rule.match}]` : ''}`
    if (!index.jobsById.has(rule.from) || !index.jobsById.has(rule.to))
      return [`required artifact edge missing: ${label}`]
    const present = index
      .artifactConsumersForProducerJob(rule.from)
      .some(
        (edge) =>
          edge.to === rule.to &&
          edge.name === rule.name &&
          (rule.match === undefined || edge.match === rule.match),
      )
    return present ? [] : [`required artifact edge missing: ${label}`]
  })
}

function inventoryDiagnostics(
  topology: WorkflowTopology,
  policy: WorkflowTopologyPolicy,
): string[] {
  const jobsById = new Map(topology.jobs.map((job) => [job.id, job]))
  const actual = new Map(
    topology.workflows.map((workflow) => [
      workflow.path,
      workflow.jobIds
        .map((id) => jobsById.get(id)?.key ?? id)
        .toSorted((a, b) => a.localeCompare(b)),
    ]),
  )
  const diagnostics: string[] = []
  for (const [path, keys] of actual) {
    const expected = policy.jobInventory[path]
    if (!expected) diagnostics.push(`workflow inventory missing: ${path}`)
    else if (JSON.stringify(keys) !== JSON.stringify([...expected].toSorted()))
      diagnostics.push(
        `job inventory mismatch: ${path}: expected ${[...expected].toSorted().join(', ')}, got ${keys.join(', ')}`,
      )
  }
  for (const path of Object.keys(policy.jobInventory).toSorted()) {
    if (!actual.has(path)) diagnostics.push(`workflow inventory stale: ${path}`)
  }
  return diagnostics
}

function jobPresenceDiagnostics(
  index: WorkflowTopologyIndex,
  policy: WorkflowTopologyPolicy,
): string[] {
  const diagnostics: string[] = []
  for (const id of policy.requiredJobs)
    if (!index.jobsById.has(id)) diagnostics.push(`required job missing: ${id}`)
  for (const id of policy.forbiddenJobs)
    if (index.jobsById.has(id)) diagnostics.push(`forbidden job present: ${id}`)
  return diagnostics
}

function edgeDiagnostics(
  index: WorkflowTopologyIndex,
  rules: readonly EdgeRule[],
  direct: boolean,
  required: boolean,
): string[] {
  return rules.flatMap(([from, to]) => {
    if (!index.jobsById.has(from) || !index.jobsById.has(to))
      return required
        ? [`required ${direct ? 'direct' : 'transitive'} edge missing: ${from} -> ${to}`]
        : []
    const downstream = direct
      ? index.directDownstreamJobIds(from)
      : index.transitiveDownstreamJobIds(from)
    const present = downstream.includes(to)
    return present === required
      ? []
      : [
          `${required ? 'required' : 'forbidden'} ${direct ? 'direct' : 'transitive'} edge ${required ? 'missing' : 'present'}: ${from} -> ${to}`,
        ]
  })
}

function fanInDiagnostics(index: WorkflowTopologyIndex, policy: WorkflowTopologyPolicy): string[] {
  return Object.entries(policy.exactFanIns).flatMap(([jobId, expected]) => {
    if (!index.jobsById.has(jobId)) return [`exact fan-in target missing: ${jobId}`]
    const actual = [...index.directUpstreamJobIds(jobId)].toSorted()
    return JSON.stringify(actual) === JSON.stringify([...expected].toSorted())
      ? []
      : [
          `exact fan-in mismatch: ${jobId}: expected ${[...expected].toSorted().join(', ')}, got ${actual.join(', ')}`,
        ]
  })
}

function callerDiagnostics(index: WorkflowTopologyIndex, policy: WorkflowTopologyPolicy): string[] {
  const callablePaths: string[] = []
  for (const workflow of index.workflowsByPath.values())
    if (workflow.callable) callablePaths.push(workflow.path)
  callablePaths.sort((left, right) => left.localeCompare(right))
  const declaredPaths = Object.keys(policy.exactCallerJobs).toSorted()
  const diagnostics: string[] = []
  for (const path of callablePaths)
    if (!policy.exactCallerJobs[path]) diagnostics.push(`caller allowlist missing: ${path}`)
  for (const path of declaredPaths)
    if (!callablePaths.includes(path)) diagnostics.push(`caller allowlist stale: ${path}`)
  diagnostics.push(
    ...Object.entries(policy.exactCallerJobs).flatMap(([path, expected]) => {
      if (!index.workflowsByPath.get(path)?.callable) return []
      const actual = [...index.directCallerJobIds(path)].toSorted()
      return JSON.stringify(actual) === JSON.stringify([...expected].toSorted())
        ? []
        : [
            `caller allowlist mismatch: ${path}: expected ${[...expected].toSorted().join(', ')}, got ${actual.join(', ')}`,
          ]
    }),
  )
  return diagnostics
}

function matches(
  selector: StepSelector,
  step: { id?: string; uses?: string; name?: string },
): boolean {
  return (
    (selector.id === undefined || selector.id === step.id) &&
    (selector.uses === undefined || selector.uses === step.uses) &&
    (selector.name === undefined || selector.name === step.name)
  )
}

function stepOrderDiagnostics(
  index: WorkflowTopologyIndex,
  policy: WorkflowTopologyPolicy,
): string[] {
  return policy.stepOrders.flatMap((rule) => {
    const job = index.jobsById.get(rule.jobId)
    if (!job) return [`step-order job missing: ${rule.jobId}`]
    let prior = -1
    for (const selector of rule.steps) {
      const step = job.steps.find((candidate) => matches(selector, candidate))
      const label = selector.id ?? selector.uses ?? selector.name ?? '<step>'
      if (!step) return [`required ordered step missing: ${rule.jobId}: ${label}`]
      if (step.index <= prior) return [`required step order invalid: ${rule.jobId}: ${label}`]
      prior = step.index
    }
    return []
  })
}
