import type { FeedbackCoverage } from '../agent-blackboard/index.mts'
import { normalizeRepositories } from '../agent-blackboard/feedback-codec.mts'
import { runPolicyExport, type PolicyRun } from './policy-run.mts'
import type { RetrospectiveFrontMatter } from './retrospective-front-matter.mts'

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

/** Rejects, naming the field, any argument the document's own front matter contradicts. */
export function checkFrontMatter(
  front: RetrospectiveFrontMatter,
  args: {
    sessionId: string
    workOutcome: string
    feedbackCoverage: FeedbackCoverage
    repositories: string[] | undefined
  },
): void {
  const mismatches: string[] = []
  if (front.sessionId !== undefined && front.sessionId !== args.sessionId)
    mismatches.push('session_id does not match sessionId')
  if (front.workOutcome !== undefined && front.workOutcome !== args.workOutcome)
    mismatches.push('work_outcome does not match workOutcome')
  if (front.feedbackCoverage !== undefined) {
    // Field by field, so the document's JSON key order does not matter; sources stay ordered.
    const { status, sources, droppedCount } = args.feedbackCoverage
    const given = front.feedbackCoverage
    if (
      given.status !== status ||
      given.droppedCount !== droppedCount ||
      !same(given.sources, sources)
    )
      mismatches.push('feedback_coverage does not match feedbackCoverage')
  }
  if (
    front.repositories !== undefined &&
    args.repositories !== undefined &&
    !same(normalizeRepositories(front.repositories), normalizeRepositories(args.repositories))
  )
    mismatches.push('repositories does not match repositories')
  if (mismatches.length)
    throw new Error(
      `retrospective front matter contradicts the arguments: ${mismatches.join('; ')}`,
    )
}

/**
 * The canonical (sorted, deduplicated, lowercase) repositories: the argument, else the
 * document's front matter, else the policy's `pullRequestDefaults().repositories`, else an error.
 */
export async function resolveRepositories(
  args: string[] | undefined,
  front: string[] | undefined,
  policy: Omit<PolicyRun, 'export' | 'input'>,
): Promise<string[]> {
  const given = args ?? front
  if (given !== undefined) return normalizeRepositories(given)
  const defaults = await runPolicyExport({ ...policy, export: 'pullRequestDefaults', input: {} })
  const repositories = (defaults.status === 'ok' ? defaults.result : undefined) as
    | { repositories?: unknown }
    | null
    | undefined
  if (Array.isArray(repositories?.repositories) && repositories.repositories.length)
    return normalizeRepositories(repositories.repositories)
  throw new Error(
    'repositories is required: pass it, put it in the front matter, or have the policy ' +
      'pullRequestDefaults export return { repositories }',
  )
}
