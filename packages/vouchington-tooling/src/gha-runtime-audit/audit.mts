import {
  parseArray,
  parseObject,
  parseRun,
  parseSample,
  parseWorkflow,
  type GhApiExecutor,
  type RunRecord,
  type RuntimeAuditResult,
  type RuntimeSample,
  type WorkflowRecord,
} from './model.mts'
import { buildRuntimeResults, type RuntimeSamplesByJob } from './results.mts'
import {
  isRunInScope,
  isSelectedWorkflow,
  matchingWorkflowFilter,
  resolveRuntimeAuditOptions,
  type ResolvedRuntimeAuditOptions,
  type RuntimeAuditOptions,
  type RuntimeAuditWorkflowFilter,
} from './scope.mts'

async function discoverWorkflows(
  execute: GhApiExecutor,
  options: ResolvedRuntimeAuditOptions,
): Promise<WorkflowRecord[]> {
  const selected: WorkflowRecord[] = []
  for (let page = 1; ; page += 1) {
    const response = parseObject(
      await execute({
        endpoint: `/repos/${options.repository}/actions/workflows?per_page=100&page=${page}`,
        jq: '{workflows: [.workflows[] | {id, name, state}]}',
      }),
      'workflows response must be an object',
    )
    const pageWorkflows = parseArray(response['workflows'], 'workflows must be an array')
    for (const value of pageWorkflows) {
      const workflow = parseWorkflow(value)
      if (isSelectedWorkflow(workflow, options.workflows)) selected.push(workflow)
    }
    if (pageWorkflows.length < 100) break
  }
  return selected.toSorted((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
}

function runsQuery(filter: RuntimeAuditWorkflowFilter, branch: string): string {
  if (filter.event === 'push') return `event=push&branch=${encodeURIComponent(branch)}`
  return 'event=pull_request'
}

async function recentRuns(
  execute: GhApiExecutor,
  workflow: WorkflowRecord,
  options: ResolvedRuntimeAuditOptions,
): Promise<RunRecord[]> {
  const selected: RunRecord[] = []
  const filter = matchingWorkflowFilter(workflow.name, options.workflows)
  /* v8 ignore next */
  if (!filter) return selected
  const query = runsQuery(filter, options.branch)
  for (let page = 1; ; page += 1) {
    const response = parseObject(
      await execute({
        endpoint: `/repos/${options.repository}/actions/workflows/${workflow.id}/runs?${query}&status=completed&per_page=100&page=${page}`,
        jq: '{workflow_runs: [.workflow_runs[] | {id, name, event, conclusion, created_at, html_url, head_branch, pull_requests: [(.pull_requests // [])[] | {base: {ref: .base.ref}}]}]}',
      }),
      'workflow runs response must be an object',
    )
    const pageRuns = parseArray(response['workflow_runs'], 'workflow_runs must be an array')
    const inScope: RunRecord[] = []
    for (const value of pageRuns) {
      const run = parseRun(value)
      if (isRunInScope(run, filter, options.branch)) inScope.push(run)
    }
    inScope.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id)
    for (const run of inScope) {
      if (selected.length === options.recentCompletedRunHorizon) break
      selected.push(run)
    }
    if (selected.length === options.recentCompletedRunHorizon || pageRuns.length < 100) break
  }
  return selected
}

async function collectRunSamples(
  execute: GhApiExecutor,
  options: ResolvedRuntimeAuditOptions,
  run: RunRecord,
  samplesByKey: Map<string, RuntimeSamplesByJob>,
): Promise<void> {
  for (let page = 1; ; page += 1) {
    const response = parseObject(
      await execute({
        endpoint: `/repos/${options.repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100&page=${page}`,
        jq: '{jobs: [.jobs[] | {id, name, started_at, completed_at, conclusion, html_url}]}',
      }),
      `jobs response for run ${run.id} must be an object`,
    )
    const jobs = parseArray(response['jobs'], `jobs for run ${run.id} must be an array`)
    for (const value of jobs) {
      const parsed = parseSample(value, run)
      if (!parsed) continue
      const key = `${run.name} / ${parsed.name}`
      const entry = samplesByKey.get(key) ?? {
        workflow: run.name,
        job: parsed.name,
        samples: [] as RuntimeSample[],
      }
      if (entry.samples.length < options.sampleLimit) entry.samples.push(parsed.sample)
      samplesByKey.set(key, entry)
    }
    if (jobs.length < 100) break
  }
}

export async function auditCiJobRuntime(
  execute: GhApiExecutor,
  options: RuntimeAuditOptions,
): Promise<RuntimeAuditResult> {
  const resolved = resolveRuntimeAuditOptions(options)
  const samplesByKey = new Map<string, RuntimeSamplesByJob>()
  const seenRunIds = new Set<number>()
  for (const workflow of await discoverWorkflows(execute, resolved)) {
    for (const run of await recentRuns(execute, workflow, resolved)) {
      if (seenRunIds.has(run.id)) continue
      seenRunIds.add(run.id)
      await collectRunSamples(execute, resolved, run, samplesByKey)
    }
  }
  const results = buildRuntimeResults(samplesByKey, resolved)
  return {
    scope: {
      repository: resolved.repository,
      sampleLimit: resolved.sampleLimit,
      recentCompletedRunHorizon: resolved.recentCompletedRunHorizon,
      medianThresholdSeconds: resolved.medianThresholdSeconds,
      hardCeilingSeconds: resolved.hardCeilingSeconds,
      branch: resolved.branch,
    },
    ...results,
  }
}
