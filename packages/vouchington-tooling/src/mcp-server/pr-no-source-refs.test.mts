import { describe, expect, it } from 'vitest'
import { parseNonClosingRefs } from '../gh-cli/non-closing-refs.mts'
import { harness, jsonOf, textOf, useRepoFixture } from './harness.test-helpers.mts'
import { PR_ARGS, declarePolicy, device, policy } from './pr-tools.test-helpers.mts'

const fixture = useRepoFixture()

const REFS = [
  { number: 5, relation: 'refs', reason: 'follows up' },
  { number: 6, relation: 'refs', reason: 'remote', repository: 'Owner/Other' },
]
const extra = { relatedIssues: REFS, noSourceIssue: { reason: 'scheduled prompt' } }
const args = (more: Record<string, unknown> = extra) => ({
  ...PR_ARGS,
  worktree: fixture().linked,
  ...more,
})

describe('noSourceIssue beside refs-only relatedIssues', () => {
  it('renders the Refs lines immediately before the generic statement', async () => {
    const h = harness(fixture(), { device })
    const body = String(jsonOf(await h.call('pr_validate', args())).body)
    expect(body).toContain(
      '## Related issues\n\n- Refs #5 — follows up\n- Refs owner/other#6 — remote\n' +
        '- No source issue — scheduled prompt\n\n## Details',
    )
    const section = body.split('## Related issues')[1]!.split('## Details')[0]!
    expect([...parseNonClosingRefs(section)]).toEqual(['#5', 'owner/other#6'])
  })

  it('renders the policy statement after the Refs lines and reaches the policy', async () => {
    declarePolicy(fixture())
    const p = policy((name) =>
      name === 'renderNoSourceIssue' ? '- Marker: scheduled\n' : { errors: [] },
    )
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, device })
    const body = String(jsonOf(await h.call('pr_validate', args())).body)
    expect(body).toContain('- Refs owner/other#6 — remote\n- Marker: scheduled\n\n## Details')
    expect(p.requests[1]!.input).toMatchObject({ noSourceIssue: { reason: 'scheduled prompt' } })
  })

  it('still rejects a closes entry beside noSourceIssue', async () => {
    const h = harness(fixture(), { device })
    const relatedIssues = [...REFS, { number: 7, relation: 'closes', reason: 'c' }]
    expect(textOf(await h.call('pr_validate', args({ ...extra, relatedIssues })))).toContain(
      'noSourceIssue cannot be combined with a relatedIssues entry that closes',
    )
  })

  it('rejects a refs reason that smuggles a closing reference', async () => {
    const h = harness(fixture(), { device })
    const reason = 'context; Closes #123'
    const relatedIssues = [REFS[0], { number: 8, relation: 'refs', reason }]
    expect(textOf(await h.call('pr_validate', args({ ...extra, relatedIssues })))).toContain(
      'relatedIssues[1].reason must not contain a closing reference beside noSourceIssue',
    )
    const plain = [{ number: 8, relation: 'refs', reason: 'Closes #123' }]
    expect(textOf(await h.call('pr_validate', args({ ...extra, relatedIssues: plain })))).toContain(
      'closing reference',
    )
  })

  it('allows a closing reference in a refs reason without noSourceIssue', async () => {
    const h = harness(fixture(), { device })
    const relatedIssues = [{ number: 8, relation: 'refs', reason: 'Closes #123' }]
    const out = jsonOf(await h.call('pr_validate', args({ relatedIssues })))
    expect(out).toHaveProperty('body')
  })
})
