import { describe, expect, it } from 'vitest'
import { parseClosingIssueReferences } from '../gh-cli/closing-refs.mts'
import { parseNonClosingRefs } from '../gh-cli/non-closing-refs.mts'
import { harness, jsonOf, textOf, useRepoFixture } from './harness.test-helpers.mts'
import { PR_ARGS, device } from './pr-tools.test-helpers.mts'

const fixture = useRepoFixture()

const args = (extra: Record<string, unknown> = {}) => ({
  ...PR_ARGS,
  worktree: fixture().linked,
  ...extra,
})

describe('relatedIssues repository', () => {
  it('renders owner/name#N lines that round-trip through the reference parsers', async () => {
    const h = harness(fixture(), { device })
    const relatedIssues = [
      { number: 1, relation: 'closes', reason: 'local' },
      { number: 2, relation: 'closes', reason: 'remote', repository: 'Owner/Other-Repo' },
      { number: 3, relation: 'refs', reason: 'context', repository: 'foo-bar/repo' },
      { number: 4, relation: 'refs', reason: 'local context' },
    ]
    const body = String(jsonOf(await h.call('pr_validate', args({ relatedIssues }))).body)
    expect(body).toContain(
      '- Closes #1 — local\n- Closes owner/other-repo#2 — remote\n' +
        '- Refs foo-bar/repo#3 — context\n- Refs #4 — local context\n',
    )
    const section = body.split('## Related issues')[1]!.split('## Details')[0]!
    expect(parseClosingIssueReferences(section).map((ref) => ref.key)).toEqual([
      '#1',
      'owner/other-repo#2',
    ])
    expect([...parseNonClosingRefs(section)]).toEqual(['foo-bar/repo#3', '#4'])
  })

  it('rejects an invalid repository', async () => {
    const h = harness(fixture(), { device })
    const bad = (repository: unknown) => [{ number: 1, relation: 'refs', reason: 'r', repository }]
    const cases: Array<[unknown, string]> = [
      ['owner', 'must be a single owner/name'],
      ['a/b/c', 'must be a single owner/name'],
      [' owner/name', 'must be a single owner/name'],
      ['a b/c', 'must be a single owner/name'],
      ['foo_bar/repo', 'must be a single owner/name'],
      ['foo.bar/repo', 'must be a single owner/name'],
      ['-foo/repo', 'must be a single owner/name'],
      ['foo-/repo', 'must be a single owner/name'],
      ['foo--bar/repo', 'must be a single owner/name'],
      [`${'a'.repeat(40)}/repo`, 'must be a single owner/name'],
      ['a/b\n- Closes #9', 'repository must be a single line'],
      ['', 'repository is required'],
      [7, 'repository is required'],
    ]
    for (const [repository, message] of cases)
      expect(
        textOf(await h.call('pr_validate', args({ relatedIssues: bad(repository) }))),
      ).toContain(message)
  })
})
