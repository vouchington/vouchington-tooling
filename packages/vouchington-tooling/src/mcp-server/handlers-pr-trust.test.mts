import { describe, expect, it } from 'vitest'
import { harness, jsonOf, textOf, useRepoFixture } from './harness.test-helpers.mts'
import {
  PR_ARGS,
  declarePolicy,
  device,
  fakeGh,
  policy,
  usePushedRemote,
} from './pr-tools.test-helpers.mts'

const fixture = useRepoFixture()

const args = (extra: Record<string, unknown> = {}) => ({
  ...PR_ARGS,
  worktree: fixture().linked,
  ...extra,
})

const LIVE = { body: 'x', headRefName: 'linked', baseRefName: 'trunk', state: 'OPEN' }

async function modeSeen(env: NodeJS.ProcessEnv, extra: Record<string, unknown>) {
  declarePolicy(fixture())
  const p = policy(() => ({ errors: [] }))
  const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, device, env })
  jsonOf(await h.call('pr_validate', args(extra)))
  return p.requests[0]!.input.mode
}

describe('trusted mode', () => {
  it('derives interactive from a clean launch env and lets the caller only narrow it', async () => {
    const env = { PATH: '/bin' }
    expect(await modeSeen(env, { mode: undefined })).toBe('interactive')
    expect(await modeSeen(env, { mode: 'interactive' })).toBe('interactive')
    expect(await modeSeen(env, { mode: 'autonomous' })).toBe('autonomous')
  })

  it('reports autonomous in an automation context even when the caller passes interactive', async () => {
    for (const marker of ['CI', 'GITHUB_ACTIONS', 'VOUCHINGTON_AUTOMATION', 'BUILDKITE'])
      expect(await modeSeen({ PATH: '/bin', [marker]: 'true' }, { mode: 'interactive' })).toBe(
        'autonomous',
      )
    expect(await modeSeen({ PATH: '/bin', CI: '1' }, { mode: undefined })).toBe('autonomous')
  })

  it('ignores markers that are empty, 0 or false', async () => {
    for (const value of ['', ' ', '0', 'false', 'FALSE'])
      expect(await modeSeen({ PATH: '/bin', CI: value }, { mode: 'interactive' })).toBe(
        'interactive',
      )
  })

  it('rejects an unknown mode', async () => {
    const h = harness(fixture(), { device })
    expect(textOf(await h.call('pr_validate', args({ mode: 'robot' })))).toContain(
      'mode is required',
    )
  })
})

describe('noSourceIssue', () => {
  it('renders a generic statement inside Related issues and reaches the policy', async () => {
    declarePolicy(fixture())
    const p = policy((name) => (name === 'renderNoSourceIssue' ? undefined : { errors: [] }))
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, device })
    const extra = { relatedIssues: [], noSourceIssue: { reason: 'direct user request' } }
    const body = String(jsonOf(await h.call('pr_validate', args(extra))).body)
    expect(body).toContain('## Related issues\n\n- No source issue — direct user request\n\n## D')
    expect(p.requests.map((request) => request.name)).toEqual([
      'renderNoSourceIssue',
      'validatePullRequest',
    ])
    expect(p.requests[0]!.input).toEqual({ reason: 'direct user request' })
    expect(p.requests[1]!.input).toMatchObject({
      noSourceIssue: { reason: 'direct user request' },
      mode: 'autonomous',
    })
  })

  it('lets the policy supply the rendering, and rejects an unusable one', async () => {
    declarePolicy(fixture())
    const extra = { relatedIssues: [], noSourceIssue: { reason: 'r' } }
    const custom = policy((name) =>
      name === 'renderNoSourceIssue' ? '- Marker: r\n' : { errors: [] },
    )
    const h = harness(fixture(), { spawnPolicy: custom.spawnPolicy, device })
    expect(jsonOf(await h.call('pr_validate', args(extra))).body).toContain(
      '## Related issues\n\n- Marker: r\n\n## Details',
    )
    for (const result of [' ', 7]) {
      const bad = policy((name) => (name === 'renderNoSourceIssue' ? result : { errors: [] }))
      const b = harness(fixture(), { spawnPolicy: bad.spawnPolicy, device })
      expect(textOf(await b.call('pr_validate', args(extra)))).toContain(
        'renderNoSourceIssue must return a non-empty string',
      )
    }
  })

  it('renders the default without a policy and keeps None when it is not set', async () => {
    const h = harness(fixture(), { device })
    const extra = { relatedIssues: [], noSourceIssue: { reason: 'r' } }
    expect(jsonOf(await h.call('pr_validate', args(extra))).body).toContain('- No source issue — r')
    expect(jsonOf(await h.call('pr_validate', args({ relatedIssues: [] }))).body).toContain(
      '## Related issues\n\n- None\n',
    )
  })

  it('is exclusive with related issues and must be a single-line reason', async () => {
    const h = harness(fixture(), { device })
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ noSourceIssue: { reason: 'r' } }, 'mutually exclusive'],
      [{ relatedIssues: [], noSourceIssue: { reason: 'a\nb' } }, 'reason must be a single line'],
      [{ relatedIssues: [], noSourceIssue: {} }, 'reason is required'],
      [{ relatedIssues: [], noSourceIssue: { reason: 'r', x: 1 } }, 'unsupported'],
      [{ relatedIssues: [], noSourceIssue: 'r' }, 'object'],
    ]
    for (const [extra, message] of cases)
      expect(textOf(await h.call('pr_validate', args(extra)))).toContain(message)
  })
})

describe('noSourceIssue on pr_create', () => {
  usePushedRemote(fixture)

  it('passes noSourceIssue to pullRequestDefaults', async () => {
    declarePolicy(fixture())
    const p = policy((name) => (name === 'renderNoSourceIssue' ? undefined : { errors: [] }))
    const gh = fakeGh()
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, runGh: gh.runGh, device })
    const extra = { relatedIssues: [], noSourceIssue: { reason: 'r' } }
    jsonOf(await h.call('pr_create', args(extra)))
    const defaults = p.requests.find((request) => request.name === 'pullRequestDefaults')
    expect(defaults?.input).toMatchObject({ noSourceIssue: { reason: 'r' } })
  })
})

describe('pr_validate is read-only', () => {
  it('validates a merged pull request and a head mismatch, judging the live head', async () => {
    declarePolicy(fixture())
    const p = policy(() => ({ errors: [] }))
    const merged = fakeGh({ view: { ...LIVE, state: 'MERGED', headRefName: 'other' } })
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, runGh: merged.runGh, device })
    const result = jsonOf(await h.call('pr_validate', args({ pr: 5, base: undefined })))
    expect(result.errors).toEqual([])
    expect(p.requests[0]!.input).toMatchObject({ head: 'other', base: 'trunk', pr: 5 })
    expect(merged.calls).toHaveLength(1)
    // Even a detached worktree can validate an existing pull request.
    fixture().git(fixture().linked, 'checkout', '--quiet', '--detach')
    jsonOf(await h.call('pr_validate', args({ pr: 5, base: undefined })))
  })

  it('still rejects a credential head and a head equal to the base', async () => {
    const view = { ...LIVE, headRefName: 'trunk' }
    const h = harness(fixture(), { runGh: fakeGh({ view }).runGh, device })
    expect(textOf(await h.call('pr_validate', args({ pr: 5 })))).toContain('must differ from base')
    const env = { PATH: '/bin', GH_TOKEN: 'other' }
    const named = harness(fixture(), {
      runGh: fakeGh({ view: { ...LIVE, headRefName: 'other' } }).runGh,
      device,
      env,
    })
    expect(textOf(await named.call('pr_validate', args({ pr: 5 })))).toContain('server credential')
  })

  it('keeps pr_update strict about state and head', async () => {
    const merged = harness(fixture(), {
      runGh: fakeGh({ view: { ...LIVE, state: 'MERGED' } }).runGh,
      device,
    })
    expect(textOf(await merged.call('pr_update', args({ pr: 5 })))).toContain(
      'pull request 5 is MERGED, not OPEN',
    )
    const other = harness(fixture(), {
      runGh: fakeGh({ view: { ...LIVE, headRefName: 'other' } }).runGh,
      device,
    })
    expect(textOf(await other.call('pr_update', args({ pr: 5 })))).toContain(
      'pull request 5 has head other, not the worktree branch linked',
    )
  })
})
