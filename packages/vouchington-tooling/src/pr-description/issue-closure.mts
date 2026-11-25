import type { ClosingIssueReference, RunTextCommand } from '../gh-cli/index.mts'
import type {
  ClosureLookup,
  IssueClosureResolver,
  PullRequestIdentity,
  PullRequestRefOids,
} from './pr-description-types.mts'

type ClosedEventCloser =
  | { __typename: 'Commit'; oid?: string }
  | { __typename: 'PullRequest'; number?: number; url?: string }
  | { __typename?: string }
  | null

type PullRequestResponse = {
  mergeCommit?: { oid?: string } | null
  number?: number
  state?: string
  url?: string
}

function parsePullRequestResponse(parsed: PullRequestResponse): PullRequestIdentity {
  if (
    typeof parsed.number !== 'number' ||
    typeof parsed.state !== 'string' ||
    typeof parsed.url !== 'string'
  ) {
    throw new Error('GitHub PR response missing number, state, or url')
  }
  const match = /^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)\/pull\/\d+/.exec(
    parsed.url,
  )
  if (match?.groups === undefined) throw new Error('GitHub PR response has an invalid url')
  return {
    mergeCommitOid:
      typeof parsed.mergeCommit?.oid === 'string' ? parsed.mergeCommit.oid : undefined,
    number: parsed.number,
    owner: match.groups.owner!,
    repo: match.groups.repo!,
    state: parsed.state,
  }
}

export function parsePullRequestIdentity(json: string): PullRequestIdentity {
  return parsePullRequestResponse(JSON.parse(json) as PullRequestResponse)
}

export function parsePullRequestRefOids(json: string): PullRequestRefOids {
  const parsed = JSON.parse(json) as Partial<PullRequestRefOids>
  if (typeof parsed.baseRefOid !== 'string' || typeof parsed.headRefOid !== 'string') {
    throw new Error('gh pr view response missing baseRefOid/headRefOid')
  }
  return { baseRefOid: parsed.baseRefOid, headRefOid: parsed.headRefOid }
}

function resolveCloser(
  closer: ClosedEventCloser | undefined,
  target: PullRequestIdentity,
): ClosureLookup {
  if (closer === null || closer === undefined) return { closer: null, ok: true }
  const closerType = closer['__typename']
  if (closerType === 'Commit') {
    if (!('oid' in closer) || typeof closer.oid !== 'string') {
      throw new Error('closure response missing Commit oid')
    }
    return closer.oid.toLowerCase() === target.mergeCommitOid?.toLowerCase()
      ? { closer: { number: target.number, owner: target.owner, repo: target.repo }, ok: true }
      : { closer: null, ok: true }
  }
  if (closerType !== 'PullRequest') return { closer: null, ok: true }
  if (
    !('number' in closer) ||
    typeof closer.number !== 'number' ||
    !('url' in closer) ||
    typeof closer.url !== 'string'
  ) {
    throw new Error('closure response missing PR identity')
  }
  const identity = parsePullRequestResponse({
    number: closer.number,
    state: 'MERGED',
    url: closer.url,
  })
  return {
    closer: { number: identity.number, owner: identity.owner, repo: identity.repo },
    ok: true,
  }
}

export function createIssueClosureResolver(
  runGh: RunTextCommand,
  target: PullRequestIdentity,
): IssueClosureResolver {
  return async (ref: ClosingIssueReference): Promise<ClosureLookup> => {
    try {
      const owner = ref.owner ?? target.owner
      const repo = ref.repo ?? target.repo
      const query =
        'query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){timelineItems(last:1,itemTypes:[CLOSED_EVENT]){nodes{... on ClosedEvent{closer{__typename ... on PullRequest{number url} ... on Commit{oid}}}}}}}}'
      const json = await runGh([
        'api',
        'graphql',
        '-f',
        `query=${query}`,
        '-F',
        `owner=${owner}`,
        '-F',
        `repo=${repo}`,
        '-F',
        `number=${ref.number}`,
      ])
      const parsed = JSON.parse(json) as {
        data?: {
          repository?: {
            issue?: { timelineItems?: { nodes?: Array<{ closer?: ClosedEventCloser }> } }
          }
        }
      }
      const nodes = parsed.data?.repository?.issue?.timelineItems?.nodes
      if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error('closure response missing latest ClosedEvent')
      }
      return resolveCloser(nodes.at(-1)?.closer, target)
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err), ok: false }
    }
  }
}
