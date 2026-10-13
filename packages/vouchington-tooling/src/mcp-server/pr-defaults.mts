import { runPolicyExport, type PolicyRun } from './policy-run.mts'
import type { RelatedIssue } from './pr-input.mts'

export type PullRequestDefaults = { labels: string[]; milestone?: string; project?: string }

function optionalName(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`policy pullRequestDefaults ${field} must be a non-empty string`)
  return value
}

/**
 * Labels, milestone and project from the policy's `pullRequestDefaults` export; empty when the
 * checkout declares no policy or the policy lacks the export.
 */
export async function pullRequestDefaults(
  policy: Omit<PolicyRun, 'export' | 'input'>,
  input: { title: string; base: string; relatedIssues: RelatedIssue[] },
): Promise<PullRequestDefaults> {
  const { title, base, relatedIssues } = input
  const outcome = await runPolicyExport({
    ...policy,
    export: 'pullRequestDefaults',
    input: { title, base, relatedIssues },
  })
  if (outcome.status !== 'ok') return { labels: [] }
  const result = (outcome.result ?? {}) as Record<string, unknown>
  const labels = result.labels ?? []
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string' || !label.trim()))
    throw new Error('policy pullRequestDefaults labels must be an array of non-empty strings')
  const milestone = optionalName(result.milestone, 'milestone')
  const project = optionalName(result.project, 'project')
  return {
    labels: labels as string[],
    ...(milestone === undefined ? {} : { milestone }),
    ...(project === undefined ? {} : { project }),
  }
}
