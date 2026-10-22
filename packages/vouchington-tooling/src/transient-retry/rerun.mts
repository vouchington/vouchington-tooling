import { decide, type DecisionResult } from './decision-evaluator.mts'
import { createGhApi, type GhApi } from './gh-api.mts'
import { streamGhApiLog } from './log-stream.mts'
import { DEFAULT_LOG_LIMITS, type LogLimits } from './log-window.mts'
import { buildWorkflowRunContext } from './run-context.mts'
import { fetchWorkflowRunSummary } from './run-context-jobs.mts'
import {
  isFailedWorkflowConclusion,
  type RunFetchEnv,
  type WorkflowRetryRule,
} from './run-context-types.mts'

export interface RerunKnownTransientOptions {
  /** `owner/name`; inferred from the current checkout when omitted. */
  repository?: string
  runId: string
  /** The caller's rule catalog. The engine has no built-in rules. */
  rules: readonly WorkflowRetryRule[]
  dryRun?: boolean
  limits?: Partial<LogLimits>
  api?: GhApi
  streamLog?: (path: string) => AsyncIterable<Buffer>
  log?: (message: string) => void
}

/** Process exit codes: a rerun was requested (or would be), or none was warranted. */
export const RERUN_REQUESTED = 0
export const NO_RERUN = 2

async function resolveRepository(repository: string | undefined, api: GhApi): Promise<string> {
  if (repository) return repository
  try {
    const inferred = (
      await api.run(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    ).trim()
    if (inferred) return inferred
  } catch {
    // Fall through to the actionable error below.
  }
  throw new Error(
    'Missing repository. Pass --repo owner/name, set GITHUB_REPOSITORY, or run from a gh-authenticated checkout.',
  )
}

function describeDecision(result: DecisionResult): string {
  return result.matchedRule ? `${result.decision} (rule ${result.matchedRule})` : result.decision
}

/**
 * Evaluates the injected rules for a failed workflow run and reruns it only when one rule asks
 * for a rerun. Only job names and the decision are logged; log text is never printed.
 */
export async function rerunKnownTransient({
  repository: requestedRepository,
  runId,
  rules,
  dryRun = false,
  limits,
  api = createGhApi(),
  streamLog = streamGhApiLog,
  log = console.log,
}: RerunKnownTransientOptions): Promise<number> {
  const repository = await resolveRepository(requestedRepository, api)
  const env: RunFetchEnv = {
    api,
    limits: { ...DEFAULT_LOG_LIMITS, ...limits },
    repository,
    runId,
    streamLog,
  }
  const summary = await fetchWorkflowRunSummary(env)
  log(`Workflow: ${summary.workflowName}`)
  log(`Conclusion: ${summary.conclusion ?? '(none)'}`)
  if (!isFailedWorkflowConclusion(summary.conclusion)) {
    log('Run conclusion is not failure, timed_out, or cancelled; no rerun requested.')
    return NO_RERUN
  }

  const context = await buildWorkflowRunContext(env, {
    conclusion: summary.conclusion,
    rules,
    runAttempt: summary.runAttempt,
    workflowName: summary.workflowName,
  })
  const result = await decide(context, rules, { unmatchedDecision: 'dispatch' })
  log(`Run attempt: ${context.runAttempt} (retry attempt: ${context.retryAttempt})`)
  log(`Failed jobs: ${context.failedJobNames.join(', ') || '(none)'}`)
  log(`Decision: ${describeDecision(result)}`)
  if (result.decision !== 'rerun') {
    log(`No rerun requested: decision is '${result.decision}', not 'rerun'.`)
    return NO_RERUN
  }
  if (dryRun) {
    log(`Dry run: would run gh run rerun --repo ${repository} ${runId}`)
    return RERUN_REQUESTED
  }
  await api.run(['run', 'rerun', '--repo', repository, runId])
  log(`Requested rerun for run ${runId}.`)
  return RERUN_REQUESTED
}
