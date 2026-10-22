import type { GhApi } from './gh-api.mts'
import type { LogLimits } from './log-window.mts'
import type { RetryContext, RetryRule } from './types.mts'

export interface WorkflowJobStep {
  conclusion?: string | null
  name: string
  number?: number
  started_at?: string | null
  status?: string
}

export interface JobEntry {
  name: string
  id: number
  conclusion?: string
  steps?: WorkflowJobStep[]
}

export type WorkflowConclusion = 'failure' | 'timed_out' | 'cancelled'

/**
 * A workflow run as the decision core sees it. `runAttempt`, `retryAttempt`, `retryAttempts` and
 * `targetNames` (the run's job names) satisfy {@link RetryContext}; the rest lets rules read job
 * state, bounded logs and annotations lazily. Logs and annotations are fetched only on first use.
 */
export interface WorkflowRunContext extends RetryContext {
  workflowName: string
  conclusion: WorkflowConclusion
  /** Every job GitHub created for the run, in API order. */
  jobNames: readonly string[]
  jobConclusions: ReadonlyMap<string, string | undefined>
  jobSteps: ReadonlyMap<string, readonly WorkflowJobStep[]>
  failedJobNames: readonly string[]
  /** Bounded log text per failed job. */
  failedJobLogs: () => Promise<Map<string, string>>
  /** Failed jobs whose logs could not be read; their text is the empty string. */
  failedJobLogFetchFailures: () => Promise<Set<string>>
  /** Bounded log text for explicitly named jobs, including successful ones. */
  jobLogs: (jobNames: readonly string[]) => Promise<Map<string, string>>
  failedJobAnnotations: (jobName: string) => Promise<string[]>
  failedJobAnnotationFetchFailures: () => Promise<Set<string>>
}

export type WorkflowRetryRule = RetryRule<WorkflowRunContext>

/** Everything the fetchers share: the `gh` client, the log stream and the identity of the run. */
export interface RunFetchEnv {
  api: GhApi
  limits: LogLimits
  repository: string
  runId: string
  streamLog: (path: string) => AsyncIterable<Buffer>
}

export function isFailedWorkflowConclusion(
  conclusion: string | null | undefined,
): conclusion is WorkflowConclusion {
  return conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'cancelled'
}
