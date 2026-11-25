import type { RunTextCommand } from '../gh-cli/index.mts'

/**
 * Default threshold for milestone-completion auditing: fires when the number of still-open issues
 * remaining in a milestone after subtracting this PR's own closes is small enough to disposition.
 */
export const DEFAULT_MILESTONE_COMPLETION_REMAINDER = 3

export type MilestoneGroup = {
  milestone: string
  numbers: Set<number>
  repo: string
}

export type MilestoneSibling = {
  milestone: string
  number: number
  repo: string
  title: string
}

type RawMilestoneIssue = { number: number; title: string }

export function buildMilestoneListArgs(repo: string, milestone: string): string[] {
  return [
    'issue',
    'list',
    '--repo',
    repo,
    '--milestone',
    milestone,
    '--state',
    'open',
    '--json',
    'number,title',
    '--limit',
    '100',
  ]
}

/**
 * Enumerates remaining open siblings for each `(repo, milestone)` group touched by a PR. Silent
 * (`[]`) when the remainder exceeds `remainder`. A per-group query failure degrades only that group
 * to `[]` so other groups still complete.
 */
export async function findMilestoneCompletionSiblings(
  runGh: RunTextCommand,
  groups: ReadonlyMap<string, MilestoneGroup>,
  remainder: number = DEFAULT_MILESTONE_COMPLETION_REMAINDER,
): Promise<MilestoneSibling[]> {
  const results = await Promise.all(
    Array.from(groups.values()).map(async (group) => {
      try {
        const json = await runGh(buildMilestoneListArgs(group.repo, group.milestone))
        const parsed: unknown = JSON.parse(json)
        if (!Array.isArray(parsed)) return []
        const issues = parsed as RawMilestoneIssue[]
        const remaining = issues.filter((issue) => !group.numbers.has(issue.number))
        if (remaining.length > remainder) return []
        return remaining.map((issue) => ({
          milestone: group.milestone,
          number: issue.number,
          repo: group.repo,
          title: issue.title,
        }))
      } catch {
        return []
      }
    }),
  )
  return results.flat()
}
