import { deriveRetryAttempt } from './attempts.mts'
import { buildJobsContext, fetchJobs, fetchPriorAttemptJobCounts } from './run-context-jobs.mts'
import { deriveRuleAttempts } from './run-context-rule-attempts.mts'
import type {
  RunFetchEnv,
  WorkflowConclusion,
  WorkflowRetryRule,
  WorkflowRunContext,
} from './run-context-types.mts'

export interface BuildWorkflowRunContextOptions {
  conclusion: WorkflowConclusion
  /** Rules replayed over prior attempts to count each rerun rule's occurrences. */
  rules?: readonly WorkflowRetryRule[]
  runAttempt: number
  workflowName: string
}

export async function buildWorkflowRunContext(
  env: RunFetchEnv,
  { conclusion, rules, runAttempt, workflowName }: BuildWorkflowRunContextOptions,
): Promise<WorkflowRunContext> {
  const priorCounts = await fetchPriorAttemptJobCounts(env, runAttempt)
  const knownCounts = priorCounts.every((count) => count !== null)
    ? (priorCounts as number[])
    : undefined
  const retryAttempt =
    knownCounts === undefined ? runAttempt : deriveRetryAttempt(runAttempt, knownCounts)
  const context = buildJobsContext(env, await fetchJobs(env), {
    conclusion,
    retryAttempt,
    runAttempt,
    workflowName,
  })
  if (rules === undefined || knownCounts === undefined) return context
  const retryAttempts = await deriveRuleAttempts(env, {
    priorCounts: knownCounts,
    rules,
    runAttempt,
    workflowName,
  }).catch(() => undefined)
  return retryAttempts === undefined ? context : { ...context, retryAttempts }
}
