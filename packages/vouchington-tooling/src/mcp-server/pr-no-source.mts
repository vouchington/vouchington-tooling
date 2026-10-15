import { runPolicyExport, type PolicyRun } from './policy-run.mts'
import type { PullRequestInput } from './pr-input.mts'

/**
 * The statement for the Related issues section of a pull request with no source issue, from the
 * policy's optional `renderNoSourceIssue({ reason })` export (a non-empty string, rendered as is).
 * Undefined when the pull request has a source issue, or the checkout declares no such export, in
 * which case the generic default statement renders.
 */
export async function noSourceStatement(
  policy: Omit<PolicyRun, 'export' | 'input'>,
  input: PullRequestInput,
): Promise<string | undefined> {
  if (input.noSourceIssue === undefined) return undefined
  const outcome = await runPolicyExport({
    ...policy,
    export: 'renderNoSourceIssue',
    input: { reason: input.noSourceIssue.reason },
  })
  if (outcome.status !== 'ok') return undefined
  if (typeof outcome.result !== 'string' || !outcome.result.trim())
    throw new Error('policy renderNoSourceIssue must return a non-empty string')
  return outcome.result.trim()
}
