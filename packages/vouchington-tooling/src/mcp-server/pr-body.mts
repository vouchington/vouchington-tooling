import { basename } from 'node:path'
import { formatReferenceKey } from '../gh-cli/closing-refs.mts'
import type { PullRequestInput, RelatedIssue } from './pr-input.mts'
import { assertNoOpenFence } from './pr-journal.mts'

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
  const [owner, repo] = issue.repository?.split('/') ?? []
  return `- ${verb} ${formatReferenceKey({ number: issue.number, owner, repo })} — ${issue.reason}`
}

/** The default no-source statement; a policy `renderNoSourceIssue` export may replace it. */
function defaultNoSourceStatement(reason: string): string {
  return `- No source issue — ${reason}`
}

/**
 * The pull request body: the Summary, Impact, Related issues and Details sections followed by the
 * provenance lines, collapsed in a Provenance disclosure because they serve audits, not reviewers.
 * With `noSourceIssue` the Related issues section ends with `noSourceStatement` (default
 * {@link defaultNoSourceStatement}), after any `Refs` lines, instead of `- None`. Pure; the caller
 * supplies the device and worktree facts. Throws when the fields leave a code fence open.
 */
export function renderPullRequestBody(
  input: PullRequestInput,
  provenance: PullRequestProvenance,
  noSourceStatement?: string,
): string {
  const related = input.relatedIssues.map(relatedLine)
  if (input.noSourceIssue !== undefined)
    related.push(noSourceStatement ?? defaultNoSourceStatement(input.noSourceIssue.reason))
  if (!related.length) related.push('- None')
  const fields = [
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
  ].join('\n')
  // An unclosed fence would turn the Provenance disclosure and its lines into visible code.
  assertNoOpenFence(fields)
  return [
    fields,
    '',
    '<details>',
    '<summary>Provenance</summary>',
    '',
    `Workspace setup: ${input.workspaceSetup}`,
    `Agent: ${provenance.agent} session ${provenance.sessionId}`,
    `Device: ${provenance.user}@${provenance.host.toLowerCase()}`,
    `Worktree: ${provenance.worktree}`,
    '',
    '</details>',
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
