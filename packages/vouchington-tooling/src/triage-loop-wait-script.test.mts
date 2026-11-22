import { afterEach, describe, expect, it } from 'vitest'

import { type Env, ejection, makeEnv, mergeEvent } from './triage-loop-scripts.test-helpers.mts'

let env: Env
afterEach(() => env.cleanup())

const iso = (offsetSeconds = 0) =>
  new Date(Date.now() + offsetSeconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z')
const json = (line: string | undefined) => JSON.parse(line!) as Record<string, any>
const npxArgs = (n: number) => JSON.parse(env.log('npx.log')[n]!) as string[]

describe('wait.py quiet merges', () => {
  it('keeps waiting through a clean merge and lists it on the next return', () => {
    env = makeEnv()
    env.clean(5)
    env.hh(1, [mergeEvent('m1', 5)])
    env.hh(2, [ejection])
    const result = env.run('wait.py')
    expect(result.code).toBe(0)
    expect(result.lines).toHaveLength(2)
    expect(json(result.lines[0])).toEqual({
      gap: false,
      events: 1,
      quiet: { count: 1, merges: ['repo-a#5'] },
    })
    expect(result.lines[1]).toBe(
      '{"id":"e1","repo":"org/repo-a","event":"merge_group","action":"destroyed","prs":[9],"reason":"failure","headSha":"abc"}',
    )
    expect(npxArgs(1)).toEqual(expect.arrayContaining(['--after', 'c1']))
    expect(npxArgs(0)).toEqual(expect.arrayContaining(['--since', '10m', '--timeout', '2h']))
    expect(env.state().hookHarness).toEqual({ seen: ['m1'], cursor: 'c1' })
    expect(env.state().quietMerges).toEqual([])
    expect(env.hhLast()).toMatchObject({ cursor: 'c2', events: [{ id: 'e1' }] })
  })

  it('does not replay a clean merge already seen, and returns on an empty timeout', () => {
    env = makeEnv()
    env.seed({ hookHarness: { seen: ['m1'], cursor: 'c0' } })
    env.hh(1, [mergeEvent('m1', 5)])
    env.hh(2, [], { timedOut: true })
    const result = env.run('wait.py')
    expect(json(result.lines[0])).toEqual({ gap: false, timedOut: true, events: 0 })
    expect(env.state().hookHarness.cursor).toBe('c1')
    expect(env.log('gh.log')).toHaveLength(0)
  })

  it('returns a merge with a late review or unresolved thread with its counts', () => {
    env = makeEnv()
    env.gql('reviewThreads', 7, [{ isResolved: false }])
    env.gql('reviews', 7, [{ body: 'bug', submittedAt: '2026-11-20T12:00:00Z' }])
    env.hh(1, [mergeEvent('m7', 7)])
    const result = env.run('wait.py')
    expect(json(result.lines[0]).events).toBe(1)
    expect(json(result.lines[1])).toMatchObject({
      id: 'm7',
      merged: true,
      unresolved: 1,
      late: 1,
      sender: 'jong',
    })
    expect(env.state().hookHarness?.seen ?? []).toEqual([])
  })

  it('returns a merge whose reviews exceed the pages read', () => {
    env = makeEnv()
    env.gql('reviewThreads', 8, [], { next: 'c' })
    for (let page = 0; page < 5; page++) env.gql('reviewThreads', 8, [], { cursor: 'c', next: 'c' })
    env.gql('reviews', 8, [])
    env.hh(1, [mergeEvent('m8', 8)])
    expect(json(env.run('wait.py').lines[1])).toMatchObject({ id: 'm8', truncated: true })
  })

  it('returns a merge whose late-review check fails instead of dropping it', () => {
    env = makeEnv()
    env.hh(1, [mergeEvent('m9', 9)])
    const result = env.run('wait.py')
    expect(result.code).toBe(0)
    expect(json(result.lines[1])).toMatchObject({
      id: 'm9',
      lateReviewError: 'gh exited 1: HTTP 502',
    })
  })

  it('returns closes without merge, gaps, and timeouts', () => {
    env = makeEnv()
    const closed = {
      ...mergeEvent('c1', 3),
      payload: { pull_request: { number: 3, merged: false } },
    }
    env.hh(1, [closed], { gap: true, timedOut: true })
    const lines = env.run('wait.py').lines
    expect(json(lines[0])).toEqual({ gap: true, timedOut: true, events: 1 })
    expect(json(lines[1])).toMatchObject({ id: 'c1', merged: false })
  })

  it('passes a hook-harness failure exit code through', () => {
    env = makeEnv()
    env.mock('hh-1.code', '3')
    expect(env.run('wait.py').code).toBe(3)
  })
})

describe('wait.py dependency-bot merges', () => {
  it('accumulates repos for an update check and returns them with the next event', () => {
    env = makeEnv()
    env.clean(11)
    env.clean(12)
    env.hh(1, [mergeEvent('b1', 11, true), mergeEvent('b2', 12, true)])
    env.hh(2, [ejection])
    const result = env.run('wait.py')
    expect(json(result.lines[0])).toMatchObject({
      quiet: { count: 2, merges: ['repo-a#11', 'repo-a#12'] },
      pendingUpdateChecks: ['repo-a'],
    })
    expect(env.state().pendingUpdateChecks).toEqual([{ repo: 'repo-a', at: expect.any(String) }])
  })

  it('returns a due update check without waiting', () => {
    env = makeEnv()
    env.seed({ pendingUpdateChecks: [{ repo: 'repo-b', at: iso(-3600) }] })
    const result = env.run('wait.py')
    expect(json(result.lines[0])).toEqual({
      gap: false,
      events: 0,
      pendingUpdateChecks: ['repo-b'],
      updateCheckDue: true,
    })
    expect(env.log('npx.log')).toHaveLength(0)
    expect(env.hhLast()).toEqual({ events: [], gap: false })
  })

  it('shortens the wait to when the oldest pending check falls due', () => {
    env = makeEnv({ eventWait: { updateCheckDelay: '60s' } })
    env.seed({ pendingUpdateChecks: [{ repo: 'repo-b', at: iso(-30) }] })
    env.hh(1, [], { timedOut: true })
    const result = env.run('wait.py')
    expect(npxArgs(0)[npxArgs(0).indexOf('--timeout') + 1]).toMatch(/^(29|30)s$/)
    expect(json(result.lines[0])).toMatchObject({
      timedOut: true,
      updateCheckDue: true,
      pendingUpdateChecks: ['repo-b'],
    })
  })

  it('does not flag an update check when the overall timeout comes first', () => {
    env = makeEnv({ eventWait: { timeout: '5m' } })
    env.seed({ pendingUpdateChecks: [{ repo: 'repo-b', at: iso() }] })
    env.hh(1, [], { timedOut: true })
    expect(json(env.run('wait.py').lines[0])).toEqual({
      gap: false,
      timedOut: true,
      events: 0,
      pendingUpdateChecks: ['repo-b'],
    })
  })

  it('accepts a late-review finding on a dependency-bot merge and still queues its check', () => {
    env = makeEnv()
    env.gql('reviewThreads', 13, [{ isResolved: false }])
    env.gql('reviews', 13, [])
    env.hh(1, [mergeEvent('b3', 13, true)])
    const result = env.run('wait.py')
    expect(json(result.lines[1])).toMatchObject({ unresolved: 1 })
    expect(json(result.lines[0]).pendingUpdateChecks).toEqual(['repo-a'])
  })
})

describe('wait.py watches', () => {
  it('returns a trigger once the last watched PR merges and marks the watch', () => {
    env = makeEnv()
    env.clean(20)
    env.clean(21)
    env.seed({
      watches: [
        {
          id: 'w1',
          prs: ['org/repo-a#20', 'org/repo-a#21'],
          notify: 'planner',
          note: 'now rebase',
        },
      ],
    })
    env.hh(1, [mergeEvent('w-a', 20)])
    env.hh(2, [mergeEvent('w-b', 21)])
    const result = env.run('wait.py')
    expect(result.lines).toHaveLength(2)
    expect(json(result.lines[0])).toMatchObject({
      events: 1,
      quiet: { count: 2, merges: ['repo-a#20', 'repo-a#21'] },
    })
    expect(json(result.lines[1])).toEqual({
      event: 'watch',
      id: 'w1',
      notify: 'planner',
      note: 'now rebase',
      prs: ['org/repo-a#20', 'org/repo-a#21'],
    })
    const [watch] = env.state().watches
    expect(watch).toMatchObject({
      merged: ['org/repo-a#20', 'org/repo-a#21'],
      triggeredAt: expect.any(String),
    })
    expect(npxArgs(1)).toContain('c1')
  })

  it('does not trigger a watch again or for unrelated merges', () => {
    env = makeEnv()
    env.clean(30)
    env.seed({
      watches: [
        { id: 'done', prs: ['org/repo-a#30'], notify: 'x', triggeredAt: 't' },
        { id: 'open', prs: ['org/repo-a#30', 'org/repo-a#31'], notify: 'y' },
      ],
    })
    env.hh(1, [mergeEvent('w-c', 30)])
    env.hh(2, [], { timedOut: true })
    const result = env.run('wait.py')
    expect(result.lines).toHaveLength(1)
    expect(env.state().watches[1]).toMatchObject({ merged: ['org/repo-a#30'] })
    expect(env.state().watches[1].triggeredAt).toBeUndefined()
  })
})

describe('wait.py cursor and config', () => {
  it('advances the cursor for returned events with --advance', () => {
    env = makeEnv()
    env.hh(1, [ejection])
    const result = env.run('wait.py', '--advance')
    expect(json(result.lines[0])).toMatchObject({ advanced: true })
    expect(env.state().hookHarness).toEqual({ seen: ['e1'], cursor: 'c1' })
  })

  it('leaves the cursor alone by default and honors eventWait.advance', () => {
    env = makeEnv()
    env.hh(1, [ejection])
    env.run('wait.py')
    expect(env.state().hookHarness.cursor).toBeUndefined()
    env.hh(2, [ejection])
    env.writeConfig({ eventWait: { advance: true } })
    env.run('wait.py')
    expect(env.state().hookHarness.cursor).toBe('c2')
  })

  it('prints compact lines without empty fields', () => {
    env = makeEnv()
    env.hh(1, [
      { ...ejection, issue: null, headRef: 'x', command: '', prs: [] },
      {
        id: 'f1',
        repo: 'org/repo-b',
        event: 'workflow_run',
        action: 'completed',
        conclusion: 'failure',
        workflow: 'CI',
        runId: 7,
        sender: { login: 'bot' },
      },
    ])
    const lines = env.run('wait.py').lines
    expect(lines[1]).not.toContain('null')
    expect(lines[1]).not.toContain('headRef')
    expect(json(lines[2])).toEqual({
      id: 'f1',
      repo: 'org/repo-b',
      event: 'workflow_run',
      action: 'completed',
      conclusion: 'failure',
      workflow: 'CI',
      runId: 7,
      sender: 'bot',
    })
  })

  it('rejects a bad duration, an unmatched repo filter, and a bad config', () => {
    env = makeEnv({ eventWait: { timeout: 'soon' } })
    expect(env.run('wait.py').err).toContain("duration 'soon'")
    env.writeConfig({ repoPrefix: 'none-' })
    expect(env.run('wait.py').err).toContain('no repositories match')
    env.writeConfig({ org: 1 })
    expect(env.run('wait.py').err).toContain('org must be a string')
  })
})
