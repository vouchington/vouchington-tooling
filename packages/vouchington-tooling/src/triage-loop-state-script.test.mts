import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { type Env, makeEnv, mergeEvent, updateDoc } from './triage-loop-scripts.test-helpers.mts'

let env: Env
afterEach(() => env.cleanup())

describe('state.py late-review', () => {
  it('prints one compact line per PR with unresolved and late counts', () => {
    env = makeEnv()
    env.clean(1)
    env.gql('reviewThreads', 2, [{ isResolved: false }, { isResolved: true }])
    env.gql('reviews', 2, [
      { body: 'late finding', submittedAt: '2026-11-20T11:00:00Z' },
      { body: '  ', submittedAt: '2026-11-20T11:00:00Z' },
      { body: null, submittedAt: '2026-11-20T11:00:00Z' },
      { body: 'early', submittedAt: '2026-11-20T09:59:59Z' },
    ])
    const result = env.run('state.py', 'late-review', 'org/repo-a#1', 'org/repo-a#2')
    expect(result.code).toBe(0)
    expect(result.lines).toEqual([
      'org/repo-a#1 MERGED mergedAt=2026-11-20T10:00:00Z unresolved=0 late=0',
      'org/repo-a#2 MERGED mergedAt=2026-11-20T10:00:00Z unresolved=1 late=1',
    ])
  })

  it('follows pagination and flags a PR with more pages than it reads', () => {
    env = makeEnv()
    env.gql('reviewThreads', 3, [{ isResolved: false }], { next: 'p2' })
    env.gql('reviewThreads', 3, [{ isResolved: false }], { cursor: 'p2' })
    env.gql('reviews', 3, [])
    env.gql('reviewThreads', 4, [{ isResolved: true }], { next: 'c' })
    env.gql('reviewThreads', 4, [{ isResolved: true }], { cursor: 'c', next: 'c' })
    env.gql('reviews', 4, [])
    const result = env.run('state.py', 'late-review', 'org/repo-a#3', 'org/repo-a#4')
    expect(result.lines[0]).toContain('unresolved=2 late=0')
    expect(result.lines[0]).not.toContain('truncated')
    expect(result.lines[1]).toMatch(/unresolved=0 late=0 truncated$/)
    expect(env.log('gh.log').filter((name) => name.includes('-4-'))).toHaveLength(6)
  })

  it('reports an API error or bad reference per PR and exits nonzero only then', () => {
    env = makeEnv()
    env.clean(1)
    env.mock('gql-reviewThreads-6-first.json', '{"data":{"repository":{"pullRequest":null}}}')
    const result = env.run(
      'state.py',
      'late-review',
      'org/repo-a#1',
      'org/repo-a#5',
      'org/repo-a#6',
      'nope',
    )
    expect(result.code).toBe(1)
    expect(result.lines[0]).toContain('unresolved=0 late=0')
    expect(result.lines[1]).toBe('org/repo-a#5 error: gh exited 1: HTTP 502')
    expect(result.lines[2]).toBe(
      'org/repo-a#6 error: pull request not found or unexpected response',
    )
    expect(result.lines[3]).toBe("nope error: 'nope' must look like owner/repo#N")
  })
})

describe('state.py watch', () => {
  it('adds, lists, and removes watches under the new top-level key', () => {
    env = makeEnv()
    const add = env.run(
      'state.py',
      'watch',
      'add',
      '--id',
      'w1',
      '--pr',
      'org/a#1',
      '--pr',
      'org/a#2',
      '--notify',
      'planner',
      '--note',
      'rebase',
    )
    expect(add.code).toBe(0)
    expect(JSON.parse(add.out)[0]).toMatchObject({
      id: 'w1',
      prs: ['org/a#1', 'org/a#2'],
      notify: 'planner',
      note: 'rebase',
    })
    expect(JSON.parse(env.run('state.py', 'watch', 'list').out)).toHaveLength(1)
    expect(
      env.run('state.py', 'watch', 'add', '--id', 'w1', '--pr', 'org/a#1', '--notify', 'x').err,
    ).toContain('already exists')
    expect(env.run('state.py', 'watch', 'add', '--id', 'w2').err).toContain('needs --id')
    expect(
      env.run('state.py', 'watch', 'add', '--id', 'w2', '--pr', 'bad', '--notify', 'x').err,
    ).toContain('owner/repo#N')
    expect(env.run('state.py', 'watch', 'remove', '--id', 'w1').out.trim()).toBe('[]')
    expect(env.state().watches).toEqual([])
  })

  it('seeds merged with PRs that already merged and completes on the last one', () => {
    env = makeEnv()
    env.mock('merged-1', 'x')
    const add = env.run(
      'state.py',
      'watch',
      'add',
      '--id',
      'w',
      '--pr',
      'org/repo-a#1',
      '--pr',
      'org/repo-a#2',
      '--notify',
      'n',
    )
    expect(JSON.parse(add.out)[0].merged).toEqual(['org/repo-a#1'])
    env.clean(2)
    env.hh(1, [mergeEvent('m2', 2)])
    const trigger = env.run('wait.py').lines[1]
    expect(trigger).toBeDefined()
    if (trigger === undefined) throw new Error('wait.py returned no watch trigger')
    expect(JSON.parse(trigger)).toMatchObject({ event: 'watch', id: 'w' })
  })

  it('refuses to add a watch when a PR state cannot be read', () => {
    env = makeEnv()
    env.mock('merged-3.fail', '')
    const add = env.run(
      'state.py',
      'watch',
      'add',
      '--id',
      'w',
      '--pr',
      'org/repo-a#3',
      '--notify',
      'n',
    )
    expect(add.code).not.toBe(0)
    expect(add.err).toContain('HTTP 404')
  })

  it('lets set and append reach the new list keys', () => {
    env = makeEnv()
    expect(env.run('state.py', 'set', 'watches', '--json', '[]').code).toBe(0)
    expect(
      env.run('state.py', 'append', 'pendingUpdateChecks', '--json', '{"repo":"a"}').code,
    ).toBe(0)
    expect(env.run('state.py', 'set', 'quietMerges', '--json', '{}').err).toContain('must be list')
  })
})

describe('state.py advance-hh', () => {
  it('still stores the cursor and the ids of the last result', () => {
    env = makeEnv()
    env.hh(1, [{ id: 'a' }, { id: 'b' }, { noId: true }])
    env.run('wait.py')
    const advance = env.run('state.py', 'advance-hh')
    expect(JSON.parse(advance.out)).toEqual({ events: 2, cursorAdvanced: true })
    expect(env.state().hookHarness).toEqual({ seen: ['a', 'b'], cursor: 'c1' })
  })
})

describe('state.py update-check-script', () => {
  const doc = readFileSync(updateDoc, 'utf8')
  const block = /```js\n([\s\S]*?)```/.exec(doc)![1]

  it('reproduces the reference script exactly for its example inputs', () => {
    env = makeEnv()
    const result = env.run(
      'state.py',
      'update-check-script',
      '--org',
      'example-org',
      '--repo',
      'example-repo',
    )
    expect(result.out).toBe(block)
  })

  it('fills in the configured org, targets, ecosystems, and dry run', () => {
    env = makeEnv()
    const result = env.run(
      'state.py',
      'update-check-script',
      '--repo',
      'a',
      '--repo',
      'b:npm,pip',
      '--dry',
    )
    expect(result.out).toContain("const ORG = 'org'\n")
    expect(result.out).toContain("const TARGETS = { 'a': null, 'b': ['npm', 'pip'] }\n")
    expect(result.out).toContain('const DRY = true\n')
  })

  it('combines repeated repositories and lets an unrestricted one win', () => {
    env = makeEnv()
    const targets = (...repos: string[]) =>
      /const TARGETS = (.*)\n/.exec(
        env.run('state.py', 'update-check-script', ...repos.flatMap((r) => ['--repo', r])).out,
      )![1]
    expect(targets('a:npm', 'a:pip', 'a:npm', 'b')).toBe("{ 'a': ['npm', 'pip'], 'b': null }")
    expect(targets('a:npm', 'a')).toBe("{ 'a': null }")
    expect(targets('a', 'a:npm')).toBe("{ 'a': null }")
  })

  it('rejects names that could inject script text', () => {
    env = makeEnv()
    expect(env.run('state.py', 'update-check-script', '--repo', "a'; x").err).toContain(
      'must be name',
    )
    expect(env.run('state.py', 'update-check-script', '--org', "o'", '--repo', 'a').err).toContain(
      'not a valid organization',
    )
    env.writeConfig({ org: undefined })
    expect(env.run('state.py', 'update-check-script', '--repo', 'a').err).toContain(
      'not a valid organization',
    )
  })
})
