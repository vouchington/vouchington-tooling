import { describe, expect, it } from 'vitest'

import {
  assessPlanCompletion,
  buildMilestoneListArgs,
  createMilestoneAuditor,
  findMilestoneCompletionSiblings,
  groupClosedIssuesByMilestone,
  validateMilestoneSiblings,
  type ClosingIssueForAudit,
  type MilestoneGroup,
  type MilestoneSibling,
} from './index.mts'

function makeClosingIssue(
  number: number,
  milestone: string | undefined,
  repo?: string,
): ClosingIssueForAudit {
  return {
    issue: {
      body: '',
      isPullRequest: false,
      milestone,
      number,
      state: 'open',
      title: `Issue ${number}`,
      url: `https://github.com/acme/repo/issues/${number}`,
    },
    repo,
  }
}

describe('milestone-query and milestone-audit', () => {
  it('builds gh issue list args and finds completion siblings with threshold and error degradation', async () => {
    expect(buildMilestoneListArgs('acme/repo', 'v1')).toEqual([
      'issue',
      'list',
      '--repo',
      'acme/repo',
      '--milestone',
      'v1',
      '--state',
      'open',
      '--json',
      'number,title',
      '--limit',
      '100',
    ])

    const groups = new Map<string, MilestoneGroup>([
      ['acme/repo m1', { milestone: 'm1', numbers: new Set([1]), repo: 'acme/repo' }],
      ['acme/repo m2', { milestone: 'm2', numbers: new Set([10]), repo: 'acme/repo' }],
      ['acme/other m3', { milestone: 'm3', numbers: new Set([20]), repo: 'acme/other' }],
      ['acme/bad m4', { milestone: 'm4', numbers: new Set([30]), repo: 'acme/bad' }],
    ])

    const siblings = await findMilestoneCompletionSiblings((args) => {
      const milestone = args[args.indexOf('--milestone') + 1]
      if (milestone === 'm1') {
        return Promise.resolve(
          JSON.stringify([
            { number: 1, title: 'Closed by PR' },
            { number: 2, title: 'Remaining' },
          ]),
        )
      }
      if (milestone === 'm2') {
        return Promise.resolve(
          JSON.stringify([
            { number: 11, title: 'A' },
            { number: 12, title: 'B' },
            { number: 13, title: 'C' },
            { number: 14, title: 'D' },
          ]),
        )
      }
      if (milestone === 'm3') return Promise.resolve(JSON.stringify({ not: 'an array' }))
      return Promise.reject(new Error('gh failed'))
    }, groups)

    expect(siblings).toEqual([
      { milestone: 'm1', number: 2, repo: 'acme/repo', title: 'Remaining' },
    ])
  })

  it('groups closing issues by repo and milestone, skipping issues without a milestone', () => {
    const grouped = groupClosedIssuesByMilestone(
      [
        makeClosingIssue(1, 'v1'),
        makeClosingIssue(2, 'v1'),
        makeClosingIssue(3, undefined),
        makeClosingIssue(4, 'v1', 'acme/other'),
      ],
      'Acme/Repo',
    )
    expect(grouped.size).toBe(2)
    expect(grouped.get('acme/repo v1')?.numbers).toEqual(new Set([1, 2]))
    expect(grouped.get('acme/other v1')?.numbers).toEqual(new Set([4]))
  })

  it('validates local and foreign milestone siblings against Closes, Refs, and keep-open markers', () => {
    const siblings: MilestoneSibling[] = [
      { milestone: 'v1', number: 2, repo: 'acme/repo', title: 'Closed self-qualified' },
      { milestone: 'v1', number: 3, repo: 'acme/repo', title: 'Referenced' },
      { milestone: 'v1', number: 4, repo: 'acme/repo', title: 'Kept open' },
      { milestone: 'v1', number: 5, repo: 'acme/other', title: 'Foreign kept open' },
      { milestone: 'v1', number: 6, repo: 'acme/other', title: 'Foreign undispositioned' },
    ]
    const body = [
      '## Related issues',
      '',
      '- Refs acme/repo#3 — follow-up',
      '<!-- issue-audit: keep-open #4 because unrelated: separate -->',
      '<!-- issue-audit: keep-open acme/other#5 because evidence-gated: awaiting run -->',
    ].join('\n')

    const errors = validateMilestoneSiblings(
      siblings,
      body,
      [{ key: 'acme/repo#2', number: 2, owner: 'acme', repo: 'repo' }],
      'Acme/Repo',
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('acme/other#6 ("Foreign undispositioned")')
  })

  it('runs createMilestoneAuditor end to end and short-circuits when there are no groups or siblings', async () => {
    let calls = 0
    const auditor = createMilestoneAuditor(() => {
      calls += 1
      return Promise.resolve(
        JSON.stringify(
          calls === 1
            ? [{ number: 1, title: 'Self' }]
            : [
                { number: 1, title: 'Self' },
                { number: 2, title: 'Open sibling' },
              ],
        ),
      )
    }, 'acme/repo')

    await expect(auditor('', [], [makeClosingIssue(1, undefined)])).resolves.toEqual([])
    expect(calls).toBe(0)

    await expect(auditor('', [], [makeClosingIssue(1, 'v1')])).resolves.toEqual([])
    expect(calls).toBe(1)

    const errors = await auditor(
      '## Related issues\n\nCloses #1\n',
      [],
      [makeClosingIssue(1, 'v1')],
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('#2 ("Open sibling")')
  })
})

describe('assessPlanCompletion', () => {
  const prBody = (refLine: string): string => `## Related issues\n\n${refLine}\n`

  it('returns none when no sibling is merged, multiple are open, or an open PR closes the plan', () => {
    expect(
      assessPlanCompletion({
        number: 10,
        pullRequests: [{ body: prBody('- Refs #10'), number: 1, state: 'OPEN' }],
        repository: 'acme/repo',
      }),
    ).toEqual({ kind: 'none' })

    expect(
      assessPlanCompletion({
        number: 10,
        pullRequests: [
          { body: prBody('- Refs #10'), merged: true, number: 1, state: 'MERGED' },
          { body: prBody('- Closes acme/repo#10'), number: 2, state: 'OPEN' },
        ],
        repository: 'acme/repo',
      }),
    ).toEqual({ kind: 'none' })

    expect(
      assessPlanCompletion({
        number: 10,
        pullRequests: [
          { body: prBody('- Refs #10'), merged: true, number: 1, state: 'MERGED' },
          { body: prBody('- Refs #10'), number: 2, state: 'OPEN' },
          { body: prBody('- Refs #10'), number: 3, state: 'OPEN' },
        ],
        repository: 'acme/repo',
      }),
    ).toEqual({ kind: 'none' })
  })

  it('reports stranded-sibling and unopened-work while ignoring unrelated and unmerged closed PRs', () => {
    expect(
      assessPlanCompletion({
        number: 10,
        pullRequests: [
          { body: prBody('- Refs #99'), merged: true, number: 1, state: 'MERGED' },
          { body: prBody('- Refs #10'), merged: false, number: 2, state: 'CLOSED' },
          { body: prBody('- Refs Acme/Repo#10'), merged: true, number: 3, state: 'MERGED' },
          { body: prBody('- Refs #10'), number: 4, state: 'OPEN' },
        ],
        repository: 'acme/repo',
      }),
    ).toEqual({ kind: 'stranded-sibling', sibling: 4 })

    expect(
      assessPlanCompletion({
        number: 10,
        pullRequests: [
          { body: prBody('- Refs other/repo#10'), merged: true, number: 1, state: 'MERGED' },
          { body: prBody('- Refs #10'), merged: true, number: 2, state: 'MERGED' },
        ],
        repository: 'acme/repo',
      }),
    ).toEqual({ kind: 'unopened-work' })
  })
})
