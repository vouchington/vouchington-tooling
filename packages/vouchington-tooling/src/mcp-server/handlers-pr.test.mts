import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const BODY = [
  '## Summary',
  '',
  'Adds the thing.',
  '',
  '## Impact',
  '',
  'Nobody breaks.',
  '',
  '## Related issues',
  '',
  '- Closes #7 — tracks the work',
  '',
  '## Details',
  '',
  'First paragraph.\n\n- a bullet',
  '',
  'Workspace setup: fresh worktree',
  'Agent: codex session native:owner',
  'Device: Jong@laptop.local',
  'Worktree: linked',
  '',
].join('\n')

describe('pr_validate', () => {
  it('renders the body and returns the policy report without calling gh', async () => {
    declarePolicy(fixture())
    const p = policy(() => ({ errors: ['bad'], warnings: ['soft'] }))
    const gh = fakeGh()
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, runGh: gh.runGh, device })
    const result = jsonOf(await h.call('pr_validate', args()))
    expect(result).toEqual({ body: BODY, errors: ['bad'], warnings: ['soft'] })
    expect(p.requests).toEqual([
      {
        name: 'validatePullRequest',
        input: {
          title: 'Add the thing',
          body: BODY,
          base: 'trunk',
          head: 'linked',
          mode: 'autonomous',
        },
      },
    ])
    expect(gh.calls).toEqual([])
  })

  it('reports no errors when the worktree declares no policy', async () => {
    const h = harness(fixture(), { device })
    expect(jsonOf(await h.call('pr_validate', args()))).toMatchObject({ errors: [], warnings: [] })
  })

  it('renders the model, refs relations, no related issues, the main worktree and the default base', async () => {
    const h = harness(fixture(), { device })
    fixture().git(fixture().main, 'checkout', '--quiet', '-b', 'topic')
    const result = jsonOf(
      await h.call(
        'pr_validate',
        args({
          worktree: fixture().main,
          model: 'opus',
          base: undefined,
          relatedIssues: [{ number: 3, relation: 'refs', reason: 'context' }],
        }),
      ),
    )
    expect(result.body).toContain('- Refs #3 — context')
    expect(result.body).toContain('Agent: codex (opus) session native:owner')
    expect(result.body).toContain('Worktree: main')
    const none = jsonOf(await h.call('pr_validate', args({ relatedIssues: [] })))
    expect(none.body).toContain('## Related issues\n\n- None\n')
  })

  it('uses the real user and host when no device is injected', async () => {
    const h = harness(fixture())
    const body = String(jsonOf(await h.call('pr_validate', args())).body)
    expect(body).toMatch(/\nDevice: .+@[^\sA-Z]+\n/)
  })

  it('labels a linked worktree under a worktrees directory by its trailing path', async () => {
    const h = harness(fixture(), { device })
    const nested = `${fixture().root}/worktrees/deep`
    fixture().git(fixture().main, 'worktree', 'add', '--quiet', '-b', 'deep', nested)
    const body = String(jsonOf(await h.call('pr_validate', args({ worktree: nested }))).body)
    expect(body).toContain('Worktree: deep\n')
  })

  it('validates an update: reads the live body, keeps its journal and passes pr', async () => {
    declarePolicy(fixture())
    const journal = '<details>\n<summary>Shepherd Journal</summary>\n\nnote\n\n</details>'
    const gh = fakeGh({ view: { body: `old\n\n${journal}\n`, headRefName: 'linked' } })
    const p = policy(() => ({ errors: [] }))
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, runGh: gh.runGh, device })
    const result = jsonOf(await h.call('pr_validate', args({ pr: 5 })))
    expect(result.body).toBe(`${BODY}\n${journal}\n`)
    expect(p.requests[0]!.input).toMatchObject({ pr: 5 })
    expect(gh.calls.map((call) => call.args)).toEqual([
      ['pr', 'view', '5', '--json', 'body,headRefName'],
    ])
  })

  it('locates the real gh on the server PATH when no runner is injected', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'vouchington-gh-'))
    try {
      const gh = join(bin, 'gh')
      writeFileSync(gh, `#!/bin/sh\necho '{"body":"live body","headRefName":"linked"}'\n`)
      chmodSync(gh, 0o755)
      const h = harness(fixture(), { device, env: { PATH: bin } })
      const result = jsonOf(await h.call('pr_validate', args({ pr: 5 })))
      expect(result.body).toBe(BODY)
    } finally {
      rmSync(bin, { recursive: true, force: true })
    }
  })

  it('rejects a live pull request on another branch or an unusable view', async () => {
    const other = fakeGh({ view: { body: 'x', headRefName: 'other' } })
    const h = harness(fixture(), { runGh: other.runGh, device })
    expect(textOf(await h.call('pr_validate', args({ pr: 5 })))).toContain(
      'pull request 5 has head other, not the worktree branch linked',
    )
    const broken = harness(fixture(), { runGh: fakeGh({ view: { body: 1 } }).runGh, device })
    expect(textOf(await broken.call('pr_validate', args({ pr: 5 })))).toContain(
      'did not return a body and headRefName',
    )
    const empty = harness(fixture(), { runGh: fakeGh({ view: null }).runGh, device })
    expect(textOf(await empty.call('pr_validate', args({ pr: 5 })))).toContain(
      'did not return a body and headRefName',
    )
  })

  it('rejects bad input', async () => {
    const h = harness(fixture(), { device })
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ title: 'a\nb' }, 'title must be a single line'],
      [{ title: 'x'.repeat(257) }, 'title must be at most 256 characters'],
      [{ summary: ' ' }, 'summary is required'],
      [{ relatedIssues: 'no' }, 'relatedIssues is required and must be an array'],
      [{ relatedIssues: [{ number: 0, relation: 'refs', reason: 'r' }] }, 'positive integer'],
      [{ relatedIssues: [{ number: 1, relation: 'fixes', reason: 'r' }] }, 'relation is required'],
      [{ relatedIssues: [{ number: 1, relation: 'refs', reason: 'r', x: 1 }] }, 'unsupported'],
      [{ details: [] }, 'details is required'],
      [{ mode: 'robot' }, 'mode is required'],
      [{ pr: 0 }, 'pr must be a positive integer'],
      [{ base: 'linked' }, 'head branch linked must differ from base linked'],
      [{ details: ['x'.repeat(70_000)] }, 'GitHub allows 65536'],
    ]
    for (const [extra, message] of cases)
      expect(textOf(await h.call('pr_validate', args(extra)))).toContain(message)
  })

  it('rejects a detached HEAD and a server launched outside a repository', async () => {
    const h = harness(fixture(), { device })
    fixture().git(fixture().linked, 'checkout', '--quiet', '--detach')
    expect(textOf(await h.call('pr_validate', args()))).toContain('detached HEAD')
    const outside = harness(fixture(), { launchRoot: undefined })
    expect(textOf(await outside.call('pr_validate', args()))).toContain(
      'policy tools require the server to be launched inside a repository worktree',
    )
  })
})

describe('pr_create', () => {
  usePushedRemote(fixture)

  it('redacts the blackboard token from the title and body before the policy and gh', async () => {
    declarePolicy(fixture())
    const p = policy(() => ({ errors: [] }))
    const gh = fakeGh()
    const env = { PATH: '/bin', AGENT_BLACKBOARD_TOKEN: 'sh0rt-tok' }
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, runGh: gh.runGh, device, env })
    const leaky = args({ title: 'Fix sh0rt-tok leak', summary: 'Saw sh0rt-tok in logs.' })
    const result = await h.call('pr_create', leaky)
    expect(result.isError).toBeUndefined()
    expect(JSON.stringify(p.requests)).not.toContain('sh0rt-tok')
    expect(JSON.stringify(gh.calls)).not.toContain('sh0rt-tok')
    expect(gh.calls[0]!.body).toContain('Saw [REDACTED] in logs.')
    expect(gh.calls[0]!.args).toContain('Fix [REDACTED] leak')
  })

  it('creates a draft pull request with a private body file, labels, milestone and project', async () => {
    declarePolicy(fixture())
    const p = policy((name) =>
      name === 'validatePullRequest'
        ? { errors: [], warnings: ['soft'] }
        : { labels: ['a', 'b'], milestone: 'M1', project: 'P1' },
    )
    const gh = fakeGh()
    const env = { PATH: '/bin', AGENT_BLACKBOARD_URL: 'u', AGENT_BLACKBOARD_TOKEN: 't', KEEP: '1' }
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, runGh: gh.runGh, device, env })
    const result = jsonOf(await h.call('pr_create', args()))
    expect(result).toEqual({
      number: 12,
      url: 'https://github.com/o/r/pull/12',
      warnings: ['soft'],
    })
    expect(p.requests.map((request) => request.name)).toEqual([
      'validatePullRequest',
      'pullRequestDefaults',
    ])
    expect(p.requests[1]!.input).toEqual({
      title: 'Add the thing',
      base: 'trunk',
      relatedIssues: PR_ARGS.relatedIssues,
    })
    const [call] = gh.calls
    const path = gh.bodyFiles[0]!.path
    expect(call!.args).toEqual([
      'pr',
      'create',
      '--title',
      'Add the thing',
      '--body-file',
      path,
      '--head',
      'linked',
      '--base',
      'trunk',
      '--draft',
      '--label',
      'a',
      '--label',
      'b',
      '--milestone',
      'M1',
      '--project',
      'P1',
    ])
    expect(call!.body).toBe(BODY)
    expect(call!.cwd).toBe(fixture().linked)
    expect(call!.env).toEqual({ PATH: '/bin', KEEP: '1' })
    expect(gh.bodyFiles[0]!.mode).toBe(0o600)
    const { existsSync } = await import('node:fs')
    expect(existsSync(path)).toBe(false)
  })

  it('creates without defaults when there is no policy, and removes the file on failure', async () => {
    const gh = fakeGh({ create: 'https://github.com/o/r/pull/9' })
    const h = harness(fixture(), { runGh: gh.runGh, device })
    expect(jsonOf(await h.call('pr_create', args()))).toMatchObject({ number: 9, warnings: [] })
    expect(gh.calls[0]!.args).not.toContain('--label')
    const odd = harness(fixture(), { runGh: fakeGh({ create: 'created' }).runGh, device })
    expect(textOf(await odd.call('pr_create', args()))).toContain(
      'could not read the pull request number from: created',
    )
  })

  it('blocks on validation errors and writes nothing', async () => {
    declarePolicy(fixture())
    const p = policy(() => ({ errors: ['no impact'] }))
    const gh = fakeGh()
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, runGh: gh.runGh, device })
    expect(textOf(await h.call('pr_create', args()))).toContain(
      'policy rejected the pull request:\n- no impact',
    )
    expect(gh.calls).toEqual([])
  })

  it('refuses an unpushed head and a pr argument', async () => {
    fixture().git(fixture().linked, 'commit', '--quiet', '--allow-empty', '-m', 'local only')
    const gh = fakeGh()
    const h = harness(fixture(), { runGh: gh.runGh, device })
    expect(textOf(await h.call('pr_create', args()))).toContain('does not match the local branch')
    expect(textOf(await h.call('pr_create', args({ pr: 3 })))).toContain('unsupported argument(s)')
    expect(gh.calls).toEqual([])
  })

  it('rejects malformed policy defaults', async () => {
    declarePolicy(fixture())
    const cases: unknown[] = [
      { labels: 'a' },
      { labels: [' '] },
      { milestone: 3 },
      { project: ' ' },
    ]
    for (const defaults of cases) {
      const p = policy((name) => (name === 'validatePullRequest' ? { errors: [] } : defaults))
      const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, runGh: fakeGh().runGh, device })
      expect(textOf(await h.call('pr_create', args()))).toContain('policy pullRequestDefaults')
    }
    const nulls = policy((name) => (name === 'validatePullRequest' ? { errors: [] } : null))
    const h = harness(fixture(), { spawnPolicy: nulls.spawnPolicy, runGh: fakeGh().runGh, device })
    expect(jsonOf(await h.call('pr_create', args()))).toMatchObject({ number: 12 })
  })
})

describe('pr_update', () => {
  const live = { body: 'old', headRefName: 'linked' }

  it('replaces the title and body, preserving only the live journal', async () => {
    declarePolicy(fixture())
    const journal = '## Shepherd Journal\n\nentry\n'
    const gh = fakeGh({ view: { ...live, body: `old text\n\n${journal}` } })
    const p = policy(() => ({ errors: [], warnings: ['soft'] }))
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, runGh: gh.runGh, device })
    const result = jsonOf(await h.call('pr_update', args({ pr: 5 })))
    expect(result).toEqual({
      number: 5,
      url: 'https://github.com/o/r/pull/5',
      warnings: ['soft'],
    })
    expect(gh.calls[1]!.args).toEqual([
      'pr',
      'edit',
      '5',
      '--title',
      'Add the thing',
      '--body-file',
      gh.bodyFiles[0]!.path,
    ])
    expect(gh.calls[1]!.body).toBe(`${BODY}\n## Shepherd Journal\n\nentry\n`)
    expect(gh.bodyFiles[0]!.mode).toBe(0o600)
  })

  it('blocks on validation errors, a wrong branch and a missing pr', async () => {
    declarePolicy(fixture())
    const p = policy(() => ({ errors: ['bad'] }))
    const gh = fakeGh({ view: live })
    const h = harness(fixture(), { spawnPolicy: p.spawnPolicy, runGh: gh.runGh, device })
    expect(textOf(await h.call('pr_update', args({ pr: 5 })))).toContain('- bad')
    expect(gh.calls).toHaveLength(1)
    expect(textOf(await h.call('pr_update', args()))).toContain('pr must be a positive integer')
    const other = harness(fixture(), {
      runGh: fakeGh({ view: { ...live, headRefName: 'x' } }).runGh,
    })
    expect(textOf(await other.call('pr_update', args({ pr: 5 })))).toContain('has head x')
  })
})
