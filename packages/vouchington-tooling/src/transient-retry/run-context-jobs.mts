import { createAnnotationFetchers } from './run-context-annotations.mts'
import { createLogFetchers } from './run-context-logs.mts'
import {
  isFailedWorkflowConclusion,
  type JobEntry,
  type RunFetchEnv,
  type WorkflowConclusion,
  type WorkflowRunContext,
} from './run-context-types.mts'

export function parseWorkflowJobEntries(stdout: string): JobEntry[] {
  const pages = JSON.parse(stdout.trim()) as { jobs?: JobEntry[] }[]
  return pages.flatMap((page) => page.jobs ?? [])
}

/** Every job of the run, or of one prior attempt when `attempt` is given. */
export async function fetchJobs(env: RunFetchEnv, attempt?: number): Promise<JobEntry[]> {
  const base = `repos/${env.repository}/actions/runs/${env.runId}`
  const path = attempt === undefined ? `${base}/jobs` : `${base}/attempts/${attempt}/jobs`
  return parseWorkflowJobEntries(await env.api.call([path, '--paginate', '--slurp']))
}

/** Job counts of attempts 1..runAttempt-1; `null` where the attempt could not be read. */
export async function fetchPriorAttemptJobCounts(
  env: RunFetchEnv,
  runAttempt: number,
): Promise<Array<number | null>> {
  return Promise.all(
    Array.from({ length: Math.max(0, runAttempt - 1) }, async (_, index) => {
      try {
        return (await fetchJobs(env, index + 1)).length
      } catch {
        return null
      }
    }),
  )
}

export interface WorkflowRunSummary {
  conclusion: string | null | undefined
  runAttempt: number
  workflowName: string
}

export async function fetchWorkflowRunSummary(env: RunFetchEnv): Promise<WorkflowRunSummary> {
  const stdout = await env.api.call([`repos/${env.repository}/actions/runs/${env.runId}`])
  const run = JSON.parse(stdout.trim()) as unknown
  const invalid = (what: string) =>
    new Error(`Invalid workflow run ${what} in GitHub API response for run ${env.runId}`)
  if (typeof run !== 'object' || run === null) throw invalid('response')

  const { conclusion, name, run_attempt: runAttempt } = run as Record<string, unknown>
  if (typeof runAttempt !== 'number' || !Number.isInteger(runAttempt) || runAttempt < 1) {
    throw invalid('attempt')
  }
  if (typeof name !== 'string' || name.length === 0) throw invalid('name')
  if (conclusion != null && typeof conclusion !== 'string') throw invalid('conclusion')
  return { conclusion, runAttempt, workflowName: name }
}

export interface JobsContextInput {
  conclusion: WorkflowConclusion
  retryAttempt: number
  runAttempt: number
  workflowName: string
}

/** Builds a context over one attempt's jobs. Logs and annotations stay unfetched until read. */
export function buildJobsContext(
  env: RunFetchEnv,
  jobs: readonly JobEntry[],
  input: JobsContextInput,
): WorkflowRunContext {
  const failedJobs = jobs.filter((job) => isFailedWorkflowConclusion(job.conclusion))
  return {
    ...input,
    jobNames: jobs.map((job) => job.name),
    targetNames: new Set(jobs.map((job) => job.name)),
    jobConclusions: new Map(jobs.map((job) => [job.name, job.conclusion])),
    jobSteps: new Map(jobs.map((job) => [job.name, job.steps ?? []])),
    failedJobNames: failedJobs.map((job) => job.name),
    ...createLogFetchers(env, jobs, failedJobs),
    ...createAnnotationFetchers(env, failedJobs),
  }
}
