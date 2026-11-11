import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { harness, jsonOf, textOf, useRepoFixture } from './harness.test-helpers.mts'
import { DIFF_MAX_OUTPUT, parseNumstat } from './pr-diff-size.mts'
import { PR_ARGS, declarePolicy, device, fakeGh, policy } from './pr-tools.test-helpers.mts'
import { runIsolatedGit } from './worktree.mts'

const fixture = useRepoFixture()
const args = (extra: Record<string, unknown> = {}) => ({
  ...PR_ARGS,
  worktree: fixture().linked,
  ...extra,
})
const LIVE = {
  body: 'x',
  headRefName: 'linked',
  headRefOid: '0'.repeat(40),
  baseRefName: 'trunk',
  state: 'OPEN',
  additions: 40,
  deletions: 7,
  changedFiles: 5,
}

/** Gives the linked worktree an origin/trunk and a commit holding a text and a binary file. */
function commitChange(): void {
  const f = fixture()
  f.git(f.linked, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD')
  writeFileSync(join(f.linked, 'a.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(f.linked, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255]))
  f.git(f.linked, 'add', '.')
  f.git(f.linked, 'commit', '--quiet', '-m', 'change')
}

function validate(
  extra: Record<string, unknown>,
  runGit?: typeof runIsolatedGit,
  view: Record<string, unknown> = LIVE,
) {
  declarePolicy(fixture())
  const p = policy(() => ({ errors: [] }))
  const gh = fakeGh({ view })
  const h = harness(fixture(), {
    spawnPolicy: p.spawnPolicy,
    runGh: gh.runGh,
    device,
    ...(runGit === undefined ? {} : { runGit }),
  })
  return { p, call: () => h.call('pr_validate', args(extra)) }
}

describe('diff size for the policy', () => {
  it('passes GitHub counts for a live pull request, whatever the worktree HEAD is', async () => {
    commitChange()
    const run = vi.fn(runIsolatedGit)
    const { p, call } = validate({ pr: 5, base: undefined }, run)
    expect(jsonOf(await call()).ok).toBe(true)
    expect(p.requests[0]!.input.diff).toEqual({
      additions: 40,
      deletions: 7,
      changedFiles: 5,
      source: 'github',
    })
    expect(run.mock.calls.some(([argv]) => argv.includes('--numstat'))).toBe(false)
  })

  it('passes the numstat totals without a live pull request, counting a binary file', async () => {
    commitChange()
    const { p, call } = validate({})
    expect(jsonOf(await call()).ok).toBe(true)
    expect(p.requests[0]!.input.diff).toEqual({
      additions: 3,
      deletions: 0,
      changedFiles: 2,
      source: 'git',
    })
  })

  it('reports unavailable when the base ref is missing, and still succeeds', async () => {
    const { p, call } = validate({})
    expect(jsonOf(await call()).ok).toBe(true)
    expect(p.requests[0]!.input.diff).toEqual({
      unavailable: 'git diff origin/trunk...HEAD failed',
    })
  })

  it('reports unavailable when git produces too much output', async () => {
    const big: typeof runIsolatedGit = async (argv) =>
      argv.includes('--numstat') ? '1\t1\tf\n'.repeat(DIFF_MAX_OUTPUT) : runIsolatedGit(argv)
    const { p, call } = validate({}, big)
    expect(jsonOf(await call()).ok).toBe(true)
    expect(p.requests[0]!.input.diff).toEqual({ unavailable: 'git diff output too large' })
  })

  it('bounds the git subprocess itself and reports its timeout or buffer overflow', async () => {
    const limits: unknown[] = []
    const failWith =
      (failure: object): typeof runIsolatedGit =>
      async (argv, given) => {
        if (!argv.includes('--numstat')) return runIsolatedGit(argv)
        limits.push(given)
        throw Object.assign(new Error('git failed'), failure)
      }
    const timedOut = validate({}, failWith({ killed: true, signal: 'SIGTERM' }))
    expect(jsonOf(await timedOut.call()).ok).toBe(true)
    expect(timedOut.p.requests[0]!.input.diff).toEqual({ unavailable: 'git diff timed out' })
    const overflow = validate({}, failWith({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }))
    expect(jsonOf(await overflow.call()).ok).toBe(true)
    expect(overflow.p.requests[0]!.input.diff).toEqual({ unavailable: 'git diff output too large' })
    expect(limits).toEqual([
      { timeout: 30_000, maxBuffer: DIFF_MAX_OUTPUT },
      { timeout: 30_000, maxBuffer: DIFF_MAX_OUTPUT },
    ])
  })

  it.each([
    ['negative', { additions: -1 }],
    ['fractional', { deletions: 1.5 }],
    ['text', { changedFiles: '2' }],
    ['missing', { additions: undefined }],
  ])('rejects a %s live count', async (_name, bad) => {
    const { call } = validate({ pr: 5, base: undefined }, undefined, { ...LIVE, ...bad })
    expect(textOf(await call())).toContain('did not return')
  })

  it('treats numstat binary entries as zero lines', () => {
    expect(parseNumstat('-\t-\tb.bin\n2\t1\ta.txt\n')).toEqual({
      additions: 2,
      deletions: 1,
      changedFiles: 2,
      source: 'git',
    })
  })
})
