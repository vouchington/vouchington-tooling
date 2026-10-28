import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { git, runActualRange, shallowClient, writeGhStub } from './gitleaks-workflow-helpers.mts'

function commit(repo: string, file: string, message: string) {
  writeFileSync(join(repo, file), `${message}\n`)
  git(repo, 'add', file)
  git(repo, 'commit', '--quiet', '-m', message)
  return git(repo, 'rev-parse', 'HEAD')
}

function createRepo() {
  const directory = mkdtempSync(join(tmpdir(), 'gitleaks-topology-'))
  const repo = join(directory, 'source')
  mkdirSync(repo)
  git(repo, 'init', '--quiet', '--initial-branch=main')
  git(repo, 'config', 'user.name', 'Gitleaks workflow test')
  git(repo, 'config', 'user.email', 'gitleaks-workflow@example.invalid')
  git(repo, 'config', 'commit.gpgsign', 'false')
  return { directory, repo, remote: join(directory, 'remote.git') }
}

// main is A-B-C, F branches from A, and H merges C and F: C is shallow after a
// bounded fetch, so A is not reachable from C and "C..H" would count too much.
function branchedMerge() {
  const fixture = createRepo()
  const a = commit(fixture.repo, 'a.txt', 'A')
  git(fixture.repo, 'switch', '--quiet', '-c', 'feature')
  const f = commit(fixture.repo, 'f.txt', 'F')
  git(fixture.repo, 'switch', '--quiet', 'main')
  commit(fixture.repo, 'b.txt', 'B')
  const c = commit(fixture.repo, 'c.txt', 'C')
  git(fixture.repo, 'switch', '--quiet', '-c', 'head', 'main')
  git(fixture.repo, 'merge', '--quiet', '--no-ff', 'feature', '-m', 'H')
  return {
    ...fixture,
    base: c,
    head: git(fixture.repo, 'rev-parse', 'HEAD'),
    range: 2,
    boundary: [c, a],
    f,
  }
}

// The PR merged main into its branch, then main moved on to a new base.
function mainMergedIntoBranch() {
  const fixture = createRepo()
  const a = commit(fixture.repo, 'a.txt', 'A')
  git(fixture.repo, 'switch', '--quiet', '-c', 'pr')
  const f = commit(fixture.repo, 'f.txt', 'F')
  git(fixture.repo, 'switch', '--quiet', 'main')
  const b = commit(fixture.repo, 'b.txt', 'B')
  git(fixture.repo, 'switch', '--quiet', 'pr')
  git(fixture.repo, 'merge', '--quiet', '--no-ff', 'main', '-m', 'G')
  const head = git(fixture.repo, 'rev-parse', 'HEAD')
  git(fixture.repo, 'switch', '--quiet', 'main')
  const c = commit(fixture.repo, 'c.txt', 'C')
  return { ...fixture, base: c, head, range: 2, boundary: [b, a], f }
}

describe.each([
  ['a merge of a branch cut from an older main commit', branchedMerge],
  ['a pull request that merged main into its branch', mainMergedIntoBranch],
])('gitleaks scan range for %s', (_name, build) => {
  it.each(['pull_request', 'merge_group'] as const)(
    '%s yields exactly the compare range',
    (event) => {
      const fixture = build()
      try {
        git(fixture.directory, 'init', '--bare', '--quiet', fixture.remote)
        git(fixture.repo, 'remote', 'add', 'origin', fixture.remote)
        git(fixture.repo, 'push', '--quiet', 'origin', '--all')
        writeGhStub(fixture.directory, fixture.repo)
        const client = join(fixture.directory, 'client')
        shallowClient(
          fixture.remote,
          client,
          `+${fixture.head}:refs/remotes/origin/head`,
          fixture.head,
        )
        const result = runActualRange(client, {
          EVENT_NAME: event,
          PR_BASE_SHA: event === 'pull_request' ? fixture.base : '',
          PR_HEAD_SHA: event === 'pull_request' ? fixture.head : '',
          MERGE_GROUP_BASE_SHA: event === 'merge_group' ? fixture.base : '',
          MERGE_GROUP_HEAD_SHA: event === 'merge_group' ? fixture.head : '',
        })
        expect(result.status, result.stdout + result.stderr).toBe(0)
        const logOpts = result.written.replace('log-opts=', '').trim().split(' ')
        expect(logOpts[0]).toBe(fixture.head)
        expect(logOpts.slice(1).sort()).toEqual(fixture.boundary.map((sha) => `^${sha}`).sort())
        const expected = git(
          fixture.repo,
          'rev-list',
          `${fixture.base}...${fixture.head}`,
          '--not',
          fixture.base,
        )
        expect(
          git(client, 'rev-list', ...logOpts)
            .split('\n')
            .sort(),
        ).toEqual(expected.split('\n').sort())
        expect(git(client, 'rev-list', '--count', ...logOpts)).toBe(String(fixture.range))
        // The naive base..head range over the shallow clone over-counts: the bug this guards.
        const mergeBase = git(fixture.repo, 'merge-base', fixture.base, fixture.head)
        git(client, 'fetch', '--quiet', '--depth=1', 'origin', mergeBase)
        expect(
          Number(git(client, 'rev-list', '--count', `${mergeBase}..${fixture.head}`)),
        ).toBeGreaterThan(fixture.range)
      } finally {
        rmSync(fixture.directory, { recursive: true, force: true })
      }
    },
  )
})
