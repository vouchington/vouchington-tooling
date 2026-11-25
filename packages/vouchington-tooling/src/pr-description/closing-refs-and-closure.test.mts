import { describe, expect, it } from 'vitest'

import type { ClosingIssueReference } from '../gh-cli/index.mts'
import {
  createClosingIssueReferenceResolver,
  createIssueClosureResolver,
  currentRepo,
  formatIssueAuditMarkerHint,
  formatReferencedIssueSummary,
  formatRelatedIssueHints,
  isValidAuditClassification,
  parseGitHubIssueApiResponse,
  parseIssueAuditKeepOpenDecisions,
  parsePullRequestIdentity,
  parsePullRequestRefOids,
  resolveClosingIssueReference,
  validateResolvedIssueReferences,
  type IssueReferenceLookup,
  type PullRequestIdentity,
  type ReferencedIssue,
} from './index.mts'

function makeIssue(overrides: Partial<ReferencedIssue> = {}): ReferencedIssue {
  return {
    body: '',
    isPullRequest: false,
    milestone: undefined,
    number: 10,
    state: 'open',
    title: 'Sample issue',
    url: 'https://github.com/acme/repo/issues/10',
    ...overrides,
  }
}

describe('closing-refs', () => {
  it('parses GitHub issue API JSON and rejects missing required fields', () => {
    const parsed = parseGitHubIssueApiResponse(
      JSON.stringify({
        body: 'Body text',
        html_url: 'https://github.com/acme/repo/issues/5',
        milestone: { title: 'v1' },
        number: 5,
        pull_request: { url: 'https://api.github.com/repos/acme/repo/pulls/5' },
        state: 'open',
        title: 'Title',
      }),
    )
    expect(parsed).toEqual({
      body: 'Body text',
      isPullRequest: true,
      milestone: 'v1',
      number: 5,
      state: 'open',
      title: 'Title',
      url: 'https://github.com/acme/repo/issues/5',
    })

    const minimal = parseGitHubIssueApiResponse(
      JSON.stringify({
        body: null,
        html_url: 'https://github.com/acme/repo/issues/6',
        milestone: null,
        number: 6,
        state: 'closed',
        title: 'Closed',
      }),
    )
    expect(minimal.body).toBe('')
    expect(minimal.isPullRequest).toBe(false)
    expect(minimal.milestone).toBeUndefined()

    expect(() => parseGitHubIssueApiResponse(JSON.stringify({ number: 'bad' }))).toThrow(
      'GitHub issue response missing required fields: html_url, number, state, title',
    )
  })

  it('validates resolved issue references with open, closed, PR, unchecked-task, and escape rules', () => {
    const refs: ClosingIssueReference[] = [
      { key: '#1', number: 1, owner: undefined, repo: undefined },
      { key: '#2', number: 2, owner: undefined, repo: undefined },
      { key: '#3', number: 3, owner: undefined, repo: undefined },
      { key: '#4', number: 4, owner: undefined, repo: undefined },
      { key: '#5', number: 5, owner: undefined, repo: undefined },
      { key: 'acme/other#6', number: 6, owner: 'acme', repo: 'other' },
    ]
    const lookups = new Map<string, IssueReferenceLookup>([
      ['#1', { issue: makeIssue({ isPullRequest: true, number: 1 }), ok: true }],
      ['#2', { issue: makeIssue({ number: 2, state: 'closed' }), ok: true }],
      ['#3', { issue: makeIssue({ body: '- [ ] unfinished', number: 3 }), ok: true }],
      ['#4', { error: 'Not Found', ok: false }],
      ['acme/other#6', { issue: makeIssue({ number: 6, state: 'closed' }), ok: true }],
    ])

    const result = validateResolvedIssueReferences(
      '<!-- related-issues-validation: allow Acme/Other#6 because intentional -->\n' +
        '<!-- related-issues-validation: allow #2 because   -->',
      refs,
      lookups,
    )
    expect(result.issues).toHaveLength(4)
    expect(result.errors).toHaveLength(5)
    expect(result.errors[0]).toContain('#1 resolves to a pull request')
    expect(result.errors[1]).toContain('#2 is CLOSED')
    expect(result.errors[2]).toContain('#3 contains at least one unchecked task')
    expect(result.errors[3]).toContain(
      '#4 could not be resolved as an open GitHub issue: Not Found',
    )
    expect(result.errors[4]).toContain('#5 could not be resolved as an open GitHub issue.')

    const mergedOpen = validateResolvedIssueReferences(
      '',
      [{ key: '#10', number: 10, owner: undefined, repo: undefined }],
      new Map([['#10', { issue: makeIssue({ number: 10, state: 'open' }), ok: true }]]),
      new Set(),
      true,
    )
    expect(mergedOpen.errors[0]).toContain('#10 remains OPEN after merge')

    const allowedClosed = validateResolvedIssueReferences(
      '',
      [{ key: '#10', number: 10, owner: undefined, repo: undefined }],
      new Map([['#10', { issue: makeIssue({ number: 10, state: 'closed' }), ok: true }]]),
      new Set(['#10']),
      true,
    )
    expect(allowedClosed.errors).toEqual([])
  })
})

describe('related-issues', () => {
  it('formats hints and referenced issue summaries', () => {
    expect(formatRelatedIssueHints([])).toBe('')
    expect(
      formatRelatedIssueHints([{ number: 7, title: 'Candidate', url: 'https://example.com/7' }]),
    ).toContain('#7: Candidate')

    expect(formatReferencedIssueSummary([])).toBe('')
    const summary = formatReferencedIssueSummary([
      makeIssue({ number: 1, state: 'open', title: 'One' }),
      makeIssue({ isPullRequest: true, number: 2, state: 'closed', title: 'Two' }),
    ])
    expect(summary).toContain('#1 OPEN issue: One')
    expect(summary).toContain('#2 CLOSED pull request: Two')
  })

  it('resolves currentRepo and caches lookups, resetting cache on failure', async () => {
    await expect(
      currentRepo(() => Promise.resolve(JSON.stringify({ nameWithOwner: '' }))),
    ).rejects.toThrow('could not determine current GitHub repository')

    let repoCalls = 0
    const resolver = createClosingIssueReferenceResolver((args) => {
      if (args[0] === 'repo') {
        repoCalls += 1
        if (repoCalls === 1) return Promise.reject(new Error('transient'))
        return Promise.resolve(JSON.stringify({ nameWithOwner: 'acme/repo' }))
      }
      if (args[1] === 'repos/acme/other/issues/9') {
        return Promise.reject('non-error string')
      }
      return Promise.resolve(
        JSON.stringify({
          html_url: 'https://github.com/acme/repo/issues/1',
          number: 1,
          state: 'open',
          title: 'First',
        }),
      )
    })

    const failed = await resolver({ key: '#1', number: 1, owner: undefined, repo: undefined })
    expect(failed).toEqual({ error: 'transient', ok: false })

    const ok1 = await resolver({ key: '#1', number: 1, owner: undefined, repo: undefined })
    const ok2 = await resolver({ key: '#1', number: 1, owner: undefined, repo: undefined })
    expect(ok1.ok).toBe(true)
    expect(ok2.ok).toBe(true)
    expect(repoCalls).toBe(2)

    const crossRepoFail = await resolver({
      key: 'acme/other#9',
      number: 9,
      owner: 'acme',
      repo: 'other',
    })
    expect(crossRepoFail).toEqual({ error: 'non-error string', ok: false })

    const directDefault = await resolveClosingIssueReference(
      { key: '#1', number: 1, owner: undefined, repo: undefined },
      (args) =>
        args[0] === 'repo'
          ? Promise.resolve(JSON.stringify({ nameWithOwner: 'acme/repo' }))
          : Promise.resolve(
              JSON.stringify({
                html_url: 'https://github.com/acme/repo/issues/1',
                number: 1,
                state: 'open',
                title: 'Direct',
              }),
            ),
    )
    expect(directDefault.ok).toBe(true)
  })
})

describe('issue-closure', () => {
  const TARGET: PullRequestIdentity = {
    mergeCommitOid: 'abc123',
    number: 50,
    owner: 'acme',
    repo: 'repo',
    state: 'MERGED',
  }

  it('parses pull request identity and ref OIDs', () => {
    expect(
      parsePullRequestIdentity(
        JSON.stringify({
          mergeCommit: { oid: 'deadbeef' },
          number: 12,
          state: 'MERGED',
          url: 'https://github.com/acme/repo/pull/12',
        }),
      ),
    ).toEqual({
      mergeCommitOid: 'deadbeef',
      number: 12,
      owner: 'acme',
      repo: 'repo',
      state: 'MERGED',
    })
    expect(
      parsePullRequestIdentity(
        JSON.stringify({ number: 12, state: 'OPEN', url: 'https://github.com/acme/repo/pull/12' }),
      ).mergeCommitOid,
    ).toBeUndefined()
    expect(() => parsePullRequestIdentity(JSON.stringify({ number: 12 }))).toThrow(
      'GitHub PR response missing number, state, or url',
    )
    expect(() =>
      parsePullRequestIdentity(
        JSON.stringify({ number: 12, state: 'OPEN', url: 'https://example.com/12' }),
      ),
    ).toThrow('GitHub PR response has an invalid url')

    expect(
      parsePullRequestRefOids(JSON.stringify({ baseRefOid: 'aaa', headRefOid: 'bbb' })),
    ).toEqual({ baseRefOid: 'aaa', headRefOid: 'bbb' })
    expect(() => parsePullRequestRefOids(JSON.stringify({ baseRefOid: 'aaa' }))).toThrow(
      'gh pr view response missing baseRefOid/headRefOid',
    )
  })

  it('resolves commit, pull request, null, unknown, and malformed closer responses', async () => {
    const ref: ClosingIssueReference = { key: '#1', number: 1, owner: undefined, repo: undefined }
    const makeResolver = (closer: unknown) =>
      createIssueClosureResolver(
        () =>
          Promise.resolve(
            JSON.stringify({
              data: { repository: { issue: { timelineItems: { nodes: [{ closer }] } } } },
            }),
          ),
        TARGET,
      )

    await expect(makeResolver({ __typename: 'Commit', oid: 'ABC123' })(ref)).resolves.toEqual({
      closer: { number: 50, owner: 'acme', repo: 'repo' },
      ok: true,
    })
    await expect(makeResolver({ __typename: 'Commit', oid: 'other' })(ref)).resolves.toEqual({
      closer: null,
      ok: true,
    })
    await expect(makeResolver({ __typename: 'Commit' })(ref)).resolves.toEqual({
      error: 'closure response missing Commit oid',
      ok: false,
    })
    await expect(
      makeResolver({
        __typename: 'PullRequest',
        number: 50,
        url: 'https://github.com/acme/repo/pull/50',
      })({ key: 'other/org#1', number: 1, owner: 'other', repo: 'org' }),
    ).resolves.toEqual({
      closer: { number: 50, owner: 'acme', repo: 'repo' },
      ok: true,
    })
    await expect(makeResolver({ __typename: 'PullRequest', number: 50 })(ref)).resolves.toEqual({
      error: 'closure response missing PR identity',
      ok: false,
    })
    await expect(makeResolver(null)(ref)).resolves.toEqual({ closer: null, ok: true })
    await expect(makeResolver({ __typename: 'Other' })(ref)).resolves.toEqual({
      closer: null,
      ok: true,
    })

    const emptyNodes = createIssueClosureResolver(
      () =>
        Promise.resolve(
          JSON.stringify({ data: { repository: { issue: { timelineItems: { nodes: [] } } } } }),
        ),
      TARGET,
    )
    await expect(emptyNodes(ref)).resolves.toEqual({
      error: 'closure response missing latest ClosedEvent',
      ok: false,
    })

    const stringReject = createIssueClosureResolver(() => Promise.reject('boom'), TARGET)
    await expect(stringReject(ref)).resolves.toEqual({ error: 'boom', ok: false })
  })
})

describe('issue-audit-marker', () => {
  it('validates classifications, parses local and foreign markers, and formats hints', () => {
    expect(isValidAuditClassification('unrelated')).toBe(true)
    expect(isValidAuditClassification('unknown')).toBe(false)
    expect(isValidAuditClassification('custom', new Set(['custom']))).toBe(true)
    expect(formatIssueAuditMarkerHint('acme/other#9')).toBe(
      '<!-- issue-audit: keep-open acme/other#9 because <classification>: <reason> -->',
    )

    const body = [
      '<!-- issue-audit: keep-open #1 because unrelated: match only -->',
      '<!-- issue-audit: keep-open Acme/Other#2 because evidence-gated: pending telemetry -->',
      '<!-- issue-audit: keep-open #3 because invalid: skipped -->',
      '<!-- issue-audit: keep-open #4 because unrelated:   -->',
      '<!-- issue-audit: keep-open #99999999999999999999999 because unrelated: overflow -->',
    ].join('\n')
    expect(parseIssueAuditKeepOpenDecisions(body)).toEqual([
      { classification: 'unrelated', number: 1, reason: 'match only', repo: undefined },
      {
        classification: 'evidence-gated',
        number: 2,
        reason: 'pending telemetry',
        repo: 'acme/other',
      },
    ])
  })
})
