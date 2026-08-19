import type { RunRecord, WorkflowRecord } from './model.mts'

export type WorkflowNameMatch = string | RegExp

export type RuntimeAuditWorkflowFilter = {
  name: WorkflowNameMatch
  event: 'pull_request' | 'push'
}

export type RuntimeAuditOptions = {
  repository: string
  workflows: RuntimeAuditWorkflowFilter[]
  branch?: string
  sampleLimit?: number
  recentCompletedRunHorizon?: number
  medianThresholdSeconds?: number
  hardCeilingSeconds?: number
}

export type ResolvedRuntimeAuditOptions = {
  repository: string
  workflows: RuntimeAuditWorkflowFilter[]
  branch: string
  sampleLimit: number
  recentCompletedRunHorizon: number
  medianThresholdSeconds: number
  hardCeilingSeconds: number
}

function matchesWorkflowName(name: string, match: WorkflowNameMatch): boolean {
  return typeof match === 'string' ? name === match : match.test(name)
}

export function parseWorkflowNameMatch(value: string): WorkflowNameMatch {
  if (value.length >= 2 && value.startsWith('/') && value.endsWith('/')) {
    return new RegExp(value.slice(1, -1))
  }
  return value
}

export function resolveRuntimeAuditOptions(
  options: RuntimeAuditOptions,
): ResolvedRuntimeAuditOptions {
  if (!/^[^/]+\/[^/]+$/.test(options.repository)) {
    throw new Error('Repository must be owner/name')
  }
  if (options.workflows.length === 0) {
    throw new Error('At least one workflow filter is required')
  }
  return {
    repository: options.repository,
    workflows: options.workflows,
    branch: options.branch ?? 'main',
    sampleLimit: options.sampleLimit ?? 5,
    recentCompletedRunHorizon: options.recentCompletedRunHorizon ?? 10,
    medianThresholdSeconds: options.medianThresholdSeconds ?? 360,
    hardCeilingSeconds: options.hardCeilingSeconds ?? 600,
  }
}

export function matchingWorkflowFilter(
  name: string,
  filters: readonly RuntimeAuditWorkflowFilter[],
): RuntimeAuditWorkflowFilter | undefined {
  return filters.find((filter) => matchesWorkflowName(name, filter.name))
}

export function isSelectedWorkflow(
  workflow: WorkflowRecord,
  filters: readonly RuntimeAuditWorkflowFilter[],
): boolean {
  return workflow.state === 'active' && matchingWorkflowFilter(workflow.name, filters) !== undefined
}

export function isRunInScope(
  run: RunRecord,
  filter: RuntimeAuditWorkflowFilter,
  branch: string,
): boolean {
  if (run.event !== filter.event) return false
  if (filter.event === 'pull_request') return run.pullRequestBaseBranches.includes(branch)
  return run.headBranch === branch
}
