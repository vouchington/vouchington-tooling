import { deriveRetryAttempt } from './attempts.mts'
import { decide } from './decision-evaluator.mts'
import { buildJobsContext, fetchJobs } from './run-context-jobs.mts'
import type {
  JobEntry,
  RunFetchEnv,
  WorkflowConclusion,
  WorkflowRetryRule,
  WorkflowRunContext,
} from './run-context-types.mts'

export interface DeriveRuleAttemptsOptions {
  priorCounts: readonly number[]
  rules: readonly WorkflowRetryRule[]
  runAttempt: number
  workflowName: string
}

class ReplayEvidenceUnavailableError extends Error {
  readonly ruleIndex: number

  constructor(ruleId: string, ruleIndex: number) {
    super(`Cannot replay rule ${ruleId}: required prior-attempt evidence is unavailable`)
    this.ruleIndex = ruleIndex
  }
}

function failedConclusionFromJobs(jobs: readonly JobEntry[]): WorkflowConclusion {
  if (jobs.some((job) => job.conclusion === 'failure')) return 'failure'
  if (jobs.some((job) => job.conclusion === 'timed_out')) return 'timed_out'
  return 'cancelled'
}

async function throwIfReplayEvidenceFailed(
  context: WorkflowRunContext,
  ruleId: string,
  ruleIndex: number,
): Promise<void> {
  if ((await context.failedJobLogFetchFailures()).size > 0) {
    throw new ReplayEvidenceUnavailableError(ruleId, ruleIndex)
  }
  if ((await context.failedJobAnnotationFetchFailures()).size > 0) {
    throw new ReplayEvidenceUnavailableError(ruleId, ruleIndex)
  }
}

/**
 * Replays the rules over each prior attempt in order and counts, per rerun rule, how many earlier
 * attempts that rule won. The result is each rule's next-occurrence count. A rule whose replay
 * evidence cannot be fetched, and every rule after it, drops out of the map so its shared attempt
 * applies; if the very first rule is unreadable the whole replay throws.
 */
export async function deriveRuleAttempts(
  env: RunFetchEnv,
  { priorCounts, rules, runAttempt, workflowName }: DeriveRuleAttemptsOptions,
): Promise<Map<string, number>> {
  const priorReruns = new Map<string, number>()
  let replayCount = rules.length
  for (let attempt = 1; attempt < runAttempt; attempt += 1) {
    // An attempt that created no jobs still counts when a rule matches its run-level evidence.
    const jobs = priorCounts[attempt - 1] === 0 ? [] : await fetchJobs(env, attempt)
    const replayRules = rules.slice(0, replayCount)
    const context: WorkflowRunContext = {
      ...buildJobsContext(env, jobs, {
        conclusion: failedConclusionFromJobs(jobs),
        retryAttempt: deriveRetryAttempt(attempt, priorCounts.slice(0, attempt - 1)),
        runAttempt: attempt,
        workflowName,
      }),
      retryAttempts: new Map(
        replayRules.map((rule) => [rule.id, (priorReruns.get(rule.id) ?? 0) + 1]),
      ),
    }
    try {
      const result = await decide(context, replayRules, {
        afterRuleEvaluated: (replayContext, rule) =>
          throwIfReplayEvidenceFailed(replayContext, rule.id, replayRules.indexOf(rule)),
      })
      if (result.decision === 'rerun') {
        priorReruns.set(result.matchedRule, (priorReruns.get(result.matchedRule) ?? 0) + 1)
      }
    } catch (error) {
      if (!(error instanceof ReplayEvidenceUnavailableError) || error.ruleIndex === 0) throw error
      replayCount = Math.min(replayCount, error.ruleIndex)
    }
  }
  return new Map(
    rules.slice(0, replayCount).map((rule) => [rule.id, (priorReruns.get(rule.id) ?? 0) + 1]),
  )
}
