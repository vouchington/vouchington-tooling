import { parseClosingIssueReferences } from '../gh-cli/index.mts'
import { ESCAPE_COMMENT_RE } from './closing-refs.mts'

const MAX_REASON_PREVIEW_LENGTH = 200
const MAX_LEAKED_REFERENCES_PER_COMMENT = 10
const MAX_REPORTED_LEAKS = 20

/**
 * GitHub's issue-closing keyword scanner reads raw PR bodies and merge commit messages without
 * respecting HTML comment boundaries. A closing keyword inside a `related-issues-validation: allow`
 * escape comment reason (e.g. "a later PR closes #123") still closes that issue on merge.
 */
export function findEscapeCommentClosingKeywordLeaks(body: string): string[] {
  const leaks: string[] = []

  for (const match of body.matchAll(ESCAPE_COMMENT_RE)) {
    if (leaks.length >= MAX_REPORTED_LEAKS) break

    const reason = match.groups!.reason!.trim()
    const leakedRefs = parseClosingIssueReferences(reason)
    if (leakedRefs.length === 0) continue

    const keys = leakedRefs.slice(0, MAX_LEAKED_REFERENCES_PER_COMMENT).map((ref) => ref.key)
    const omitted = leakedRefs.length - keys.length
    const keyList = omitted > 0 ? `${keys.join(', ')}, and ${omitted} more` : keys.join(', ')
    const truncatedReason =
      reason.length > MAX_REASON_PREVIEW_LENGTH
        ? `${reason.slice(0, MAX_REASON_PREVIEW_LENGTH)}…`
        : reason

    leaks.push(
      `The related-issues-validation escape comment's reason text contains a GitHub closing keyword referencing ${keyList} ("${truncatedReason}"). GitHub does not respect HTML comment boundaries when scanning for closing keywords, so merging this PR would close ${keyList} despite the comment's intent. Rephrase the reason so no close/fix/resolve keyword sits directly before an issue number.`,
    )
  }

  if (leaks.length >= MAX_REPORTED_LEAKS) {
    leaks.push(
      `Additional related-issues-validation escape comments also leak GitHub closing keywords beyond the first ${MAX_REPORTED_LEAKS} shown above. Rephrase every escape comment reason so no close/fix/resolve keyword sits directly before an issue number.`,
    )
  }

  return leaks
}
