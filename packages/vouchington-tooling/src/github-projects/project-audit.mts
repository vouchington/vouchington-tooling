import type { RunTextCommand } from '../gh-cli/index.mts'
import {
  DEFAULT_PROJECT_COMPLETION_REMAINDER,
  fetchIssueProjectMemberships,
  findProjectCompletionSiblings,
  type ProjectGroup,
  type ProjectRef,
  type ProjectSibling,
} from './project-query.mts'

/** One issue this change closes: a bare number, plus the `owner/repo` it lives in when that
 * differs from the audited repo (`undefined` means the audited repo itself). */
export type ClosingIssueRef = {
  number: number
  repo?: string | undefined
}

type ClosingIssueProjects = {
  closingKey: string
  projects: ProjectRef[]
}

function splitOwnerRepo(repo: string): [owner: string, name: string] {
  const [owner, name] = repo.split('/')
  if (owner === undefined || name === undefined) {
    throw new Error(`expected "owner/repo", got "${repo}"`)
  }
  return [owner, name]
}

/**
 * Groups a change's closing issues by the open project(s) each belongs to. An issue may belong to
 * more than one open project (see `fetchIssueProjectMemberships`) — every one it belongs to gets
 * its own group entry here, audited independently rather than picked arbitrarily.
 */
export function groupClosedIssuesByProject(
  entries: ReadonlyArray<ClosingIssueProjects>,
): Map<string, ProjectGroup> {
  const grouped = new Map<string, ProjectGroup>()
  for (const { closingKey, projects } of entries) {
    for (const project of projects) {
      const group = grouped.get(project.id) ?? { keys: new Set<string>(), project }
      group.keys.add(closingKey)
      grouped.set(project.id, group)
    }
  }
  return grouped
}

/** Purely advisory formatting: there is no in-body disposition marker to check against, unlike a
 * milestone-completion audit — every remaining sibling is reported unconditionally. */
export function formatProjectAdvisories(siblings: ProjectSibling[]): string[] {
  return siblings.map(
    (sibling) =>
      `${sibling.key} ("${sibling.title}") is still open in project "${sibling.projectTitle}" ` +
      `(${sibling.projectUrl}), which this change is nearly completing.`,
  )
}

/** Formats advisory strings for display; `''` when there is nothing to show. */
export function formatProjectAdvisoryReport(advisories: readonly string[]): string {
  if (advisories.length === 0) return ''
  return [
    'Project completion advisory (non-blocking, no disposition required):',
    ...advisories.map((advisory) => `  - ${advisory}`),
    '',
  ].join('\n')
}

async function resolveClosingIssueProjects(
  runGh: RunTextCommand,
  issue: ClosingIssueRef,
  auditedOwner: string,
  auditedRepo: string,
): Promise<ClosingIssueProjects & { scopeErrorMessage: string | undefined }> {
  const [owner, repo] =
    issue.repo === undefined ? [auditedOwner, auditedRepo] : splitOwnerRepo(issue.repo)
  const closingKey = `${owner}/${repo}#${issue.number}`.toLowerCase()
  const result = await fetchIssueProjectMemberships(runGh, owner, repo, issue.number)
  if (!result.ok) {
    return {
      closingKey,
      projects: [],
      scopeErrorMessage: result.scopeError ? result.error : undefined,
    }
  }
  return { closingKey, projects: result.projects, scopeErrorMessage: undefined }
}

/**
 * Audits whether the projects a change's closing issues belong to are nearly complete, returning
 * one advisory string per remaining open item — never throws, and callers decide what to do with
 * the result (e.g. print it, never block on it). A missing/insufficient `project` scope, or a
 * GraphQL call that fails with a scope error, collapses the whole audit to a single skipped-audit
 * notice instead of failing. `remainder` overrides `DEFAULT_PROJECT_COMPLETION_REMAINDER`.
 */
export async function auditProjectCompletion(
  runGh: RunTextCommand,
  repo: string,
  closingIssues: ReadonlyArray<ClosingIssueRef>,
  remainder: number = DEFAULT_PROJECT_COMPLETION_REMAINDER,
): Promise<string[]> {
  if (closingIssues.length === 0) return []
  const [auditedOwner, auditedRepo] = splitOwnerRepo(repo)

  const resolved = await Promise.all(
    closingIssues.map((issue) =>
      resolveClosingIssueProjects(runGh, issue, auditedOwner, auditedRepo),
    ),
  )
  const scopeFailure = resolved.find((entry) => entry.scopeErrorMessage !== undefined)
  if (scopeFailure !== undefined) {
    return [`Project completion audit skipped: ${scopeFailure.scopeErrorMessage}`]
  }

  const groups = groupClosedIssuesByProject(resolved)
  if (groups.size === 0) return []
  const siblings = await findProjectCompletionSiblings(runGh, groups, remainder)
  if (siblings.length === 0) return []
  return formatProjectAdvisories(siblings)
}
