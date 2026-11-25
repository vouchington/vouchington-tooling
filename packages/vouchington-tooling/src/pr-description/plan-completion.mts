import { parseClosingIssueReferences, parseNonClosingRefs } from '../gh-cli/index.mts'
import { extractRelatedIssuesReferenceText } from './content-policy.mts'

export type PlanCompletionPullRequest = {
  body: string
  merged?: boolean
  number: number
  state: string
}

export type PlanCompletionAssessment =
  | { kind: 'none' }
  | { kind: 'stranded-sibling'; sibling: number }
  | { kind: 'unopened-work' }

function referenceKeys(
  body: string,
  repository: string,
  relatedIssuesHeading?: RegExp,
): { closing: Set<string>; refs: Set<string> } {
  const localPrefix = `${repository.toLowerCase()}#`
  const normalize = (key: string): string =>
    key.toLowerCase().startsWith(localPrefix)
      ? `#${key.slice(localPrefix.length)}`
      : key.toLowerCase()
  const related = extractRelatedIssuesReferenceText(body, relatedIssuesHeading)
  return {
    closing: new Set(
      parseClosingIssueReferences(related).map((reference) => normalize(reference.key)),
    ),
    refs: new Set([...parseNonClosingRefs(related)].map(normalize)),
  }
}

/**
 * Evaluates current PR bodies referencing an open plan issue. A warning requires at least one
 * already-merged sibling so a newly opened plan does not look like stranded completion work.
 */
export function assessPlanCompletion({
  number,
  pullRequests,
  relatedIssuesHeading,
  repository,
}: {
  number: number
  pullRequests: readonly PlanCompletionPullRequest[]
  relatedIssuesHeading?: RegExp
  repository: string
}): PlanCompletionAssessment {
  const planKey = `#${number}`
  let merged = 0
  const open: Array<{ closing: boolean; number: number }> = []

  for (const pullRequest of pullRequests) {
    const references = referenceKeys(pullRequest.body, repository, relatedIssuesHeading)
    const closing = references.closing.has(planKey)
    const nonClosing = references.refs.has(planKey)
    if (!closing && !nonClosing) continue
    if (pullRequest.state.toLowerCase() === 'open') {
      open.push({ closing, number: pullRequest.number })
    } else if (pullRequest.merged === true) {
      merged += 1
    }
  }

  if (merged === 0 || open.length > 1 || open.some((pullRequest) => pullRequest.closing)) {
    return { kind: 'none' }
  }
  if (open.length === 1) return { kind: 'stranded-sibling', sibling: open[0]!.number }
  return { kind: 'unopened-work' }
}
