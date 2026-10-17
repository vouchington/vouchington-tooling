import { basename } from 'node:path'
import type { PullRequestInput, RelatedIssue } from './pr-input.mts'

export type PullRequestProvenance = {
  sessionId: string
  /** The operating system user name. */
  user: string
  /** The host name; lowercased when rendered. */
  host: string
  /** The checkout label, see {@link worktreeLabel}. */
  worktree: string
  /** The Agent line text before the session, see `agentLabel`. */
  agent: string
}

function relatedLine(issue: RelatedIssue): string {
  const verb = issue.relation === 'closes' ? 'Closes' : 'Refs'
  return `- ${verb} #${issue.number} — ${issue.reason}`
}

/** The default no-source statement; a policy `renderNoSourceIssue` export may replace it. */
function defaultNoSourceStatement(reason: string): string {
  return `- No source issue — ${reason}`
}

/**
 * The pull request body: the Summary, Impact, Related issues and Details sections followed by the
 * provenance lines. With `noSourceIssue` the Related issues section holds `noSourceStatement`
 * (default {@link defaultNoSourceStatement}) instead of `- None`. Pure; the caller supplies the
 * device and worktree facts.
 */
export function renderPullRequestBody(
  input: PullRequestInput,
  provenance: PullRequestProvenance,
  noSourceStatement?: string,
): string {
  const related = input.relatedIssues.length
    ? input.relatedIssues.map(relatedLine)
    : [
        input.noSourceIssue === undefined
          ? '- None'
          : (noSourceStatement ?? defaultNoSourceStatement(input.noSourceIssue.reason)),
      ]
  return [
    '## Summary',
    '',
    input.summary,
    '',
    '## Impact',
    '',
    input.impact,
    '',
    '## Related issues',
    '',
    ...related,
    '',
    '## Details',
    '',
    input.details.join('\n\n'),
    '',
    `Workspace setup: ${input.workspaceSetup}`,
    `Agent: ${provenance.agent} session ${provenance.sessionId}`,
    `Device: ${provenance.user}@${provenance.host.toLowerCase()}`,
    `Worktree: ${provenance.worktree}`,
    '',
  ].join('\n')
}

const MARKER = '/worktrees/'

/**
 * The worktree label: the path after `/worktrees/` when present, `main` for the repository's main
 * worktree, else the directory name.
 */
export function worktreeLabel(worktree: string, mainWorktree: string | undefined): string {
  const marker = worktree.indexOf(MARKER)
  if (marker !== -1) return worktree.slice(marker + MARKER.length)
  return worktree === mainWorktree ? 'main' : basename(worktree)
}
