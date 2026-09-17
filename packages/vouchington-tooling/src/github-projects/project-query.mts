import type { RunTextCommand } from '../gh-cli/index.mts'

/**
 * A reasonable default for `findProjectCompletionSiblings`' `remainder` parameter: once this few
 * other open items remain in a cross-repo GitHub Projects v2 project a change is touching, the
 * project is worth calling out as nearly done. Callers may pass their own threshold instead.
 */
export const DEFAULT_PROJECT_COMPLETION_REMAINDER = 3

export type ProjectRef = {
  id: string
  title: string
  url: string
}

export type ProjectMembershipResult =
  | { ok: true; projects: ProjectRef[] }
  | { error: string; ok: false; scopeError: boolean }

export type ProjectGroup = {
  keys: Set<string>
  project: ProjectRef
}

export type ProjectSibling = {
  key: string
  projectTitle: string
  projectUrl: string
  title: string
}

type RawProject = { closed?: boolean; id?: string; title?: string; url?: string } | null | undefined
type RawProjectItemsNode = { project?: RawProject }
type RawProjectContent = {
  __typename?: string
  number?: number
  repository?: { nameWithOwner?: string }
  state?: string
  title?: string
} | null
type RawProjectContentNode = { content?: RawProjectContent }

// GitHub's real wording for a token missing the `project` scope on a ProjectV2 GraphQL field (an
// insufficient-scopes error, not a 404 or a plain permission denial) — matched case-insensitively
// against whatever the injected `runGh` surfaces in its thrown error message.
const SCOPE_ERROR_RE = /insufficient_scopes|required scopes|['"]project['"]\s+scope/i

export function isProjectScopeError(message: string): boolean {
  return SCOPE_ERROR_RE.test(message)
}

export function buildIssueProjectItemsArgs(owner: string, repo: string, number: number): string[] {
  const query =
    'query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){projectItems(first:20){nodes{project{id title url closed}}}}}}'
  return [
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `repo=${repo}`,
    '-F',
    `number=${number}`,
  ]
}

/**
 * Fetches every OPEN project an issue belongs to. An issue can carry more than one `projectItems`
 * node — a project workflow can add an issue to a project automatically — so this returns every
 * open one rather than assuming, or requiring, exactly one; callers should audit each
 * independently rather than picking one arbitrarily. Distinguishes a missing/insufficient
 * `project` scope (`scopeError: true`; callers typically collapse to a single skipped-audit
 * notice) from any other failure (callers typically degrade this one issue to "no memberships").
 */
export async function fetchIssueProjectMemberships(
  runGh: RunTextCommand,
  owner: string,
  repo: string,
  number: number,
): Promise<ProjectMembershipResult> {
  try {
    const json = await runGh(buildIssueProjectItemsArgs(owner, repo, number))
    const parsed = JSON.parse(json) as {
      data?: { repository?: { issue?: { projectItems?: { nodes?: RawProjectItemsNode[] } } } }
    }
    const nodes = parsed.data?.repository?.issue?.projectItems?.nodes ?? []
    const projects: ProjectRef[] = []
    for (const { project } of nodes) {
      if (
        project == null ||
        project.closed !== false ||
        typeof project.id !== 'string' ||
        typeof project.title !== 'string' ||
        typeof project.url !== 'string'
      ) {
        continue
      }
      projects.push({ id: project.id, title: project.title, url: project.url })
    }
    return { ok: true, projects }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err)
    return { error, ok: false, scopeError: isProjectScopeError(error) }
  }
}

export function buildProjectItemsArgs(projectId: string): string[] {
  const query =
    'query($id:ID!){node(id:$id){... on ProjectV2{items(first:100){nodes{content{__typename ... on Issue{number title state repository{nameWithOwner}}}}}}}}'
  return ['api', 'graphql', '-f', `query=${query}`, '-F', `id=${projectId}`]
}

function parseOpenProjectIssue(
  node: RawProjectContentNode,
): { key: string; title: string } | undefined {
  const content = node.content
  if (content == null || content['__typename'] !== 'Issue' || content.state !== 'OPEN')
    return undefined
  const { number, title } = content
  const nameWithOwner = content.repository?.nameWithOwner
  if (
    typeof number !== 'number' ||
    typeof title !== 'string' ||
    typeof nameWithOwner !== 'string'
  ) {
    return undefined
  }
  return { key: `${nameWithOwner.toLowerCase()}#${number}`, title }
}

/**
 * For each distinct project a change touches, enumerates that project's other open issue items
 * across every repo it spans — a project has no per-repo scoping, so one query covers all of them
 * (capped at the first 100 items). Silent (`[]`) once the remainder exceeds `remainder`
 * (`DEFAULT_PROJECT_COMPLETION_REMAINDER` unless the caller passes its own). A per-project query
 * failure degrades that one project to "no siblings audited" rather than throwing — every other
 * project still completes.
 */
export async function findProjectCompletionSiblings(
  runGh: RunTextCommand,
  groups: ReadonlyMap<string, ProjectGroup>,
  remainder: number = DEFAULT_PROJECT_COMPLETION_REMAINDER,
): Promise<ProjectSibling[]> {
  const results = await Promise.all(
    Array.from(groups.values()).map(async (group) => {
      try {
        const json = await runGh(buildProjectItemsArgs(group.project.id))
        const parsed = JSON.parse(json) as {
          data?: { node?: { items?: { nodes?: RawProjectContentNode[] } } }
        }
        const nodes = parsed.data?.node?.items?.nodes ?? []
        const open = nodes
          .map(parseOpenProjectIssue)
          .filter((item): item is { key: string; title: string } => item !== undefined)
        const remaining = open.filter((item) => !group.keys.has(item.key))
        if (remaining.length > remainder) return []
        return remaining.map((item) => ({
          key: item.key,
          projectTitle: group.project.title,
          projectUrl: group.project.url,
          title: item.title,
        }))
      } catch {
        return []
      }
    }),
  )
  return results.flat()
}
