import type { WorkflowCallEdge, WorkflowTopology } from './types.mts'

import {
  parsePermissions,
  permissionsToMap,
  requiredWorkflowPermissions,
  type Workflow,
} from './permissions.mts'

function formatPermissions(value: ReturnType<typeof parsePermissions>): string {
  if (value === null) return 'none'
  if (!(value instanceof Map)) return value
  return JSON.stringify(Object.fromEntries([...value].toSorted(([a], [b]) => a.localeCompare(b))))
}

export function callerCalleePermissionMismatches(
  topology: WorkflowTopology,
  documents: Readonly<Record<string, Workflow>>,
): string[] {
  const mismatches: string[] = []
  const jobsById = new Map(topology.jobs.map((job) => [job.id, job]))
  const workflowsById = new Map(topology.workflows.map((workflow) => [workflow.id, workflow]))
  const workflowsByPath = new Map(topology.workflows.map((workflow) => [workflow.path, workflow]))
  const localCalls = topology.edges.filter(
    (edge): edge is WorkflowCallEdge => edge.kind === 'calls' && edge.local === true,
  )

  for (const call of localCalls) {
    const callerJob = jobsById.get(call.from)
    const callee = call.to ? workflowsByPath.get(call.to) : undefined
    if (!callerJob || !callee?.callable) continue
    const callerPath = workflowsById.get(callerJob.workflowId)?.path ?? callerJob.workflowId
    const caller = documents[callerPath]
    if (!caller) throw new Error(`missing workflow document: ${callerPath}`)
    const job = caller.jobs?.[callerJob.key]
    if (!job) continue
    const calleePath = callee.path
    const calleeWorkflow = documents[calleePath]
    if (!calleeWorkflow) throw new Error(`missing workflow document: ${calleePath}`)

    const calleePerms = requiredWorkflowPermissions(calleeWorkflow)
    const jobPerms = parsePermissions(job.permissions)
    if (jobPerms == null) {
      mismatches.push(
        `  ${callerPath} job "${callerJob.key}" → ${calleePath}: missing explicit job-level permissions`,
      )
      continue
    }

    if (jobPerms === 'write-all' || calleePerms === 'write-all') {
      if (jobPerms !== calleePerms) {
        mismatches.push(
          `  ${callerPath} job "${callerJob.key}" → ${calleePath}: caller grants ${formatPermissions(jobPerms)}, callee requires ${formatPermissions(calleePerms)}`,
        )
      }
      continue
    }

    const callerMap = permissionsToMap(jobPerms)
    const calleeMap = permissionsToMap(calleePerms) ?? new Map<string, string>()
    const callerEntries = [...callerMap].toSorted(([left], [right]) => left.localeCompare(right))
    const calleeEntries = [...calleeMap].toSorted(([left], [right]) => left.localeCompare(right))
    if (JSON.stringify(callerEntries) !== JSON.stringify(calleeEntries)) {
      mismatches.push(
        `  ${callerPath} job "${callerJob.key}" → ${calleePath}: caller grants ${JSON.stringify(Object.fromEntries(callerEntries))}, callee requires ${JSON.stringify(Object.fromEntries(calleeEntries))}`,
      )
    }
  }

  return mismatches
}
