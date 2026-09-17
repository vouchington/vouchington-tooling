import { describe, expect, it } from 'vitest'

import {
  buildIssueProjectItemsArgs,
  buildProjectItemsArgs,
  DEFAULT_PROJECT_COMPLETION_REMAINDER,
  fetchIssueProjectMemberships,
  findProjectCompletionSiblings,
  isProjectScopeError,
  type ProjectGroup,
} from './project-query.mts'

const REPO = 'owner/repo'
const OTHER_REPO = 'other/repo'
const PROJECT_ID = 'PVT_kwtest'
const PROJECT = {
  id: PROJECT_ID,
  title: 'Cross-Repo Initiative',
  url: 'https://github.com/orgs/x/projects/1',
}

function group(overrides: Partial<ProjectGroup>): ProjectGroup {
  return { keys: new Set<string>(), project: PROJECT, ...overrides }
}

function argValue(args: string[], key: string): string | undefined {
  const match = args.find((a) => a.startsWith(`${key}=`))
  return match?.slice(key.length + 1)
}

describe('isProjectScopeError', () => {
  it('matches a real gh insufficient-scopes message', () => {
    expect(
      isProjectScopeError(
        "Your token has not been granted the required scopes to execute this query. The 'project' scope is required.",
      ),
    ).toBe(true)
    expect(isProjectScopeError('INSUFFICIENT_SCOPES: missing project')).toBe(true)
  })

  it('does not match an unrelated failure', () => {
    expect(isProjectScopeError('connect ECONNREFUSED 127.0.0.1:443')).toBe(false)
    expect(isProjectScopeError('Could not resolve to a Repository')).toBe(false)
  })
})

describe('buildIssueProjectItemsArgs', () => {
  it('builds a graphql query carrying owner, repo, and number', () => {
    const args = buildIssueProjectItemsArgs('owner', 'repo', 42)
    expect(args[0]).toBe('api')
    expect(args[1]).toBe('graphql')
    expect(argValue(args, 'owner')).toBe('owner')
    expect(argValue(args, 'repo')).toBe('repo')
    expect(argValue(args, 'number')).toBe('42')
  })
})

describe('fetchIssueProjectMemberships', () => {
  function fakeRunGh(nodes: unknown[]) {
    return () =>
      Promise.resolve(
        JSON.stringify({ data: { repository: { issue: { projectItems: { nodes: nodes } } } } }),
      )
  }

  it('returns every open project, filtering out closed ones and malformed nodes', async () => {
    const result = await fetchIssueProjectMemberships(
      fakeRunGh([
        { project: { closed: false, id: 'p1', title: 'Open Project', url: 'https://x/1' } },
        { project: { closed: true, id: 'p2', title: 'Closed Project', url: 'https://x/2' } },
        { project: null },
        {},
      ]),
      'owner',
      'repo',
      1,
    )
    expect(result).toEqual({
      ok: true,
      projects: [{ id: 'p1', title: 'Open Project', url: 'https://x/1' }],
    })
  })

  it('returns an empty project list when the issue belongs to none', async () => {
    const result = await fetchIssueProjectMemberships(fakeRunGh([]), 'owner', 'repo', 1)
    expect(result).toEqual({ ok: true, projects: [] })
  })

  it('flags a scope failure distinctly from any other failure', async () => {
    const scopeRunGh = () =>
      Promise.reject(new Error("The 'project' scope is required to run this query."))
    const scopeResult = await fetchIssueProjectMemberships(scopeRunGh, 'owner', 'repo', 1)
    expect(scopeResult).toEqual({
      error: "The 'project' scope is required to run this query.",
      ok: false,
      scopeError: true,
    })

    const otherRunGh = () => Promise.reject(new Error('no access to owner/repo'))
    const otherResult = await fetchIssueProjectMemberships(otherRunGh, 'owner', 'repo', 1)
    expect(otherResult).toEqual({ error: 'no access to owner/repo', ok: false, scopeError: false })
  })

  it('stringifies a non-Error rejection value', async () => {
    const runGh = () => Promise.reject('boom')
    await expect(fetchIssueProjectMemberships(runGh, 'owner', 'repo', 1)).resolves.toEqual({
      error: 'boom',
      ok: false,
      scopeError: false,
    })
  })

  it('falls back to no projects when the response omits the nested data path', async () => {
    const runGh = () => Promise.resolve('{}')
    await expect(fetchIssueProjectMemberships(runGh, 'owner', 'repo', 1)).resolves.toEqual({
      ok: true,
      projects: [],
    })
  })
})

describe('buildProjectItemsArgs', () => {
  it('builds a graphql query carrying the project node id', () => {
    const args = buildProjectItemsArgs(PROJECT_ID)
    expect(args[0]).toBe('api')
    expect(args[1]).toBe('graphql')
    expect(argValue(args, 'id')).toBe(PROJECT_ID)
  })
})

describe('findProjectCompletionSiblings', () => {
  it('defaults to a remainder of 3', () => {
    expect(DEFAULT_PROJECT_COMPLETION_REMAINDER).toBe(3)
  })

  function contentNode(overrides: {
    number: number
    repo?: string
    state?: string
    title?: string
    typename?: string
  }) {
    return {
      content: {
        __typename: overrides.typename ?? 'Issue',
        number: overrides.number,
        repository: { nameWithOwner: overrides.repo ?? REPO },
        state: overrides.state ?? 'OPEN',
        title: overrides.title ?? `Issue ${overrides.number}`,
      },
    }
  }

  function fakeRunGh(nodes: unknown[]) {
    return () => Promise.resolve(JSON.stringify({ data: { node: { items: { nodes } } } }))
  }

  it('reports remaining open items excluded by the closed-by-this-change key set', async () => {
    const nodes = [1, 2, 3, 4].map((number) => contentNode({ number }))
    const groups = new Map([
      ['k', group({ keys: new Set([`${REPO.toLowerCase()}#1`, `${REPO.toLowerCase()}#2`]) })],
    ])
    const siblings = await findProjectCompletionSiblings(fakeRunGh(nodes), groups)
    expect(siblings).toEqual([
      {
        key: `${REPO.toLowerCase()}#3`,
        projectTitle: PROJECT.title,
        projectUrl: PROJECT.url,
        title: 'Issue 3',
      },
      {
        key: `${REPO.toLowerCase()}#4`,
        projectTitle: PROJECT.title,
        projectUrl: PROJECT.url,
        title: 'Issue 4',
      },
    ])
  })

  it('stays silent once the remainder exceeds the default threshold', async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => contentNode({ number: i + 1 }))
    const groups = new Map([['k', group({})]])
    await expect(findProjectCompletionSiblings(fakeRunGh(nodes), groups)).resolves.toEqual([])
  })

  it('honors a caller-supplied remainder threshold', async () => {
    const nodes = [1, 2, 3].map((number) => contentNode({ number }))
    const groups = new Map([['k', group({})]])
    await expect(findProjectCompletionSiblings(fakeRunGh(nodes), groups, 2)).resolves.toEqual([])
    await expect(findProjectCompletionSiblings(fakeRunGh(nodes), groups, 3)).resolves.toHaveLength(
      3,
    )
  })

  it('ignores non-Issue content and non-OPEN issues', async () => {
    const nodes = [
      contentNode({ number: 1, typename: 'PullRequest' }),
      contentNode({ number: 2, state: 'CLOSED' }),
      contentNode({ number: 3 }),
    ]
    const groups = new Map([['k', group({})]])
    const siblings = await findProjectCompletionSiblings(fakeRunGh(nodes), groups)
    expect(siblings).toEqual([
      {
        key: `${REPO.toLowerCase()}#3`,
        projectTitle: PROJECT.title,
        projectUrl: PROJECT.url,
        title: 'Issue 3',
      },
    ])
  })

  it('ignores a malformed Issue node missing its repository', async () => {
    const nodes = [{ content: { __typename: 'Issue', number: 1, state: 'OPEN', title: 'No repo' } }]
    const groups = new Map([['k', group({})]])
    await expect(findProjectCompletionSiblings(fakeRunGh(nodes), groups)).resolves.toEqual([])
  })

  it('falls back to no items when the response omits the nested data path', async () => {
    const runGh = () => Promise.resolve('{}')
    const groups = new Map([['k', group({})]])
    await expect(findProjectCompletionSiblings(runGh, groups)).resolves.toEqual([])
  })

  it('spans multiple repos in one project without per-repo scoping', async () => {
    const nodes = [
      contentNode({ number: 1, repo: REPO }),
      contentNode({ number: 2, repo: OTHER_REPO }),
    ]
    const groups = new Map([['k', group({})]])
    const siblings = await findProjectCompletionSiblings(fakeRunGh(nodes), groups)
    expect(siblings.map((s) => s.key)).toEqual([`${REPO.toLowerCase()}#1`, `${OTHER_REPO}#2`])
  })

  it('issues zero calls for an empty group map', async () => {
    let calls = 0
    const runGh = () => {
      calls += 1
      return Promise.resolve('{}')
    }
    await expect(findProjectCompletionSiblings(runGh, new Map())).resolves.toEqual([])
    expect(calls).toBe(0)
  })

  it('degrades one failing project to no siblings while other projects still complete', async () => {
    const okProject = { id: 'p-ok', title: 'OK Project', url: 'https://x/ok' }
    const failProject = { id: 'p-fail', title: 'Fail Project', url: 'https://x/fail' }
    const runGh = (args: string[]) => {
      const id = argValue(args, 'id')
      if (id === failProject.id) return Promise.reject(new Error('no access to project'))
      return Promise.resolve(
        JSON.stringify({ data: { node: { items: { nodes: [contentNode({ number: 9 })] } } } }),
      )
    }
    const groups = new Map([
      ['ok', group({ project: okProject })],
      ['fail', group({ project: failProject })],
    ])
    const siblings = await findProjectCompletionSiblings(runGh, groups)
    expect(siblings).toEqual([
      {
        key: `${REPO.toLowerCase()}#9`,
        projectTitle: okProject.title,
        projectUrl: okProject.url,
        title: 'Issue 9',
      },
    ])
  })
})
