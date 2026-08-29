import { describe, expect, it, vi } from 'vitest'

vi.mock('./exec.mts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./exec.mts')>()
  return { ...actual, shell: vi.fn() }
})

import { runRetrospectiveFacts, type CommandExecutor, type CommandResult } from './index.mts'
import { shell } from './exec.mts'

const fields =
  'number,state,mergedAt,mergeCommit,changedFiles,files,commits,headRefName,baseRefName'
const pr = {
  number: 123,
  state: 'MERGED',
  mergedAt: '2026-05-31T20:00:00Z',
  mergeCommit: { oid: 'abc123' },
  changedFiles: 2,
  files: [{ path: 'dev/file.mts' }, { path: 'docs/file.md' }],
  commits: [{}, {}, {}],
  headRefName: 'topic-branch',
  baseRefName: 'main',
}

function makeExecutor(responses: Record<string, Partial<CommandResult>> = {}) {
  const calls: string[] = []
  const execute: CommandExecutor = async (command, args) => {
    const key = [command, ...args].join(' ')
    calls.push(key)
    return { ok: true, stdout: '', stderr: '', ...responses[key] }
  }
  return { calls, execute }
}

describe('retrospective facts', () => {
  it.each([
    ['MERGED', 'yes (GitHub reports PR MERGED into main)'],
    ['OPEN', 'no (GitHub reports PR OPEN)'],
    ['CLOSED', 'no (GitHub reports PR CLOSED)'],
    ['UNKNOWN', 'unavailable'],
  ])('uses authoritative foreign %s state without local Git', async (state, expected) => {
    const key = `gh pr view 49 --repo vouchington/vouchington-infra --json ${fields}`
    const { calls, execute } = makeExecutor({
      [key]: { stdout: JSON.stringify({ ...pr, number: 49, state }) },
    })
    const output = await runRetrospectiveFacts({
      pr: '49',
      repo: 'vouchington/vouchington-infra',
      execute,
    })
    expect(output).toContain(`Merged to main: ${expected}`)
    expect(calls).toEqual([key])
  })

  it('keeps local ancestry behavior and never treats a failed diff as a changed file', async () => {
    const { execute } = makeExecutor({
      'git branch --show-current': { stdout: 'feature\n' },
      'git rev-list --count origin/main..feature': { stdout: '1\n' },
      'git diff --name-only origin/main...feature': { ok: false, stderr: 'bad diff' },
      'git status --porcelain --untracked-files=normal': { stdout: '' },
      'git reflog show origin/feature': { stdout: '' },
      'git merge-base --is-ancestor feature origin/main': { stdout: '' },
    })
    const output = await runRetrospectiveFacts({ noPr: true, execute })
    expect(output).toContain('Merged to main: yes (origin/main contains feature)')
    expect(output).toContain('Files changed from origin/main: unavailable')
    expect(output).toContain('Top-level dirs changed from origin/main: unavailable')
  })

  it('does not run the no-PR merge-base check without origin/main', async () => {
    const { calls, execute } = makeExecutor({
      'git fetch origin main:refs/remotes/origin/main': { ok: false, stderr: 'offline' },
      'git rev-parse --verify --quiet refs/remotes/origin/main': { ok: false },
      'git branch --show-current': { stdout: 'feature' },
      'git status --porcelain --untracked-files=normal': { stdout: '' },
      'git reflog show origin/feature': { stdout: '' },
    })
    const output = await runRetrospectiveFacts({ noPr: true, execute })
    expect(output).toContain('Fetch note: origin/main unavailable after failed fetch')
    expect(calls).not.toContain('git merge-base --is-ancestor HEAD origin/main')
  })

  it('uses the PR head for remote history and includes exact captured raw evidence', async () => {
    const gh = `gh pr view 123 --json ${fields}`
    const { calls, execute } = makeExecutor({
      'git branch --show-current': { stdout: 'topic-branch' },
      [gh]: { stdout: JSON.stringify(pr) },
      'git status --porcelain --untracked-files=normal': { stdout: '' },
      'git reflog show origin/topic-branch': { stdout: 'a update by push\n', stderr: 'notice' },
      'git merge-base --is-ancestor abc123 origin/main': { stdout: '' },
    })
    const output = await runRetrospectiveFacts({ pr: '123', raw: true, execute })
    expect(calls).toContain('git reflog show origin/topic-branch')
    expect(output).toContain('$ git branch --show-current')
    expect(output).toContain(`$ ${gh}`)
    expect(output).toContain('stderr:\nnotice')
  })

  it.each(['OPEN', 'CLOSED'])(
    'keeps local %s PRs without a merge commit unmerged',
    async (state) => {
      const gh = `gh pr view 123 --json ${fields}`
      const { execute } = makeExecutor({
        'git branch --show-current': { stdout: 'topic-branch' },
        [gh]: { stdout: JSON.stringify({ ...pr, state, mergeCommit: null }) },
        'git status --porcelain --untracked-files=normal': { stdout: '' },
        'git reflog show origin/topic-branch': { stdout: '' },
      })
      await expect(runRetrospectiveFacts({ pr: '123', execute })).resolves.toContain(
        'Merged to main: unmerged at time of retro',
      )
    },
  )

  it('uses --branch for local scope even with an explicit PR', async () => {
    const gh = `gh pr view 123 --json ${fields}`
    const { calls, execute } = makeExecutor({
      'git branch --show-current': { stdout: 'topic-branch' },
      [gh]: { stdout: JSON.stringify({ ...pr, headRefName: 'other' }) },
      'git rev-parse --verify --quiet refs/heads/other-topic': { stdout: '' },
      'git merge-base --is-ancestor abc123 origin/main': { stdout: '' },
    })
    const output = await runRetrospectiveFacts({ pr: '123', branch: 'other-topic', execute })
    expect(output).toContain('Branch: other-topic')
    expect(output).toContain('Working tree changes: n/a (scoped to other-topic)')
    expect(calls).not.toContain('git rev-list --count origin/main..HEAD')
  })

  it('preserves API truncation and root-directory annotations', async () => {
    const gh = `gh pr view 123 --json ${fields}`
    const { execute } = makeExecutor({
      'git branch --show-current': { stdout: 'topic-branch' },
      [gh]: {
        stdout: JSON.stringify({
          ...pr,
          changedFiles: 150,
          files: [{ path: 'CLAUDE.md' }],
          commits: Array.from({ length: 100 }, () => ({})),
        }),
      },
      'git status --porcelain --untracked-files=normal': { stdout: '' },
      'git reflog show origin/topic-branch': { stdout: '' },
      'git merge-base --is-ancestor abc123 origin/main': { stdout: '' },
    })
    const output = await runRetrospectiveFacts({ pr: '123', execute })
    expect(output).toContain('Commits ahead of origin/main: unavailable')
    expect(output).toContain(
      "PR commits: 100+ (gh's commits list caps at 100; actual count may be higher)",
    )
    expect(output).toContain(
      'Files changed from GitHub API: 150 (partial: gh returned 1 of 150 changed files)',
    )
    expect(output).toContain(
      'Top-level dirs changed from GitHub API: root (partial: gh returned 1 of 150 changed files)',
    )
  })

  it.each([{ pr: '--raw' }, { branch: '' }, { repo: 'bad' }, { noPr: true, repo: 'o/r' }])(
    'rejects invalid option %#',
    async (options) => {
      await expect(
        runRetrospectiveFacts({ ...options, execute: makeExecutor().execute }),
      ).rejects.toThrow()
    },
  )

  it.each([
    { repo: 'o/r' },
    {},
    { pr: '1', noPr: true },
    { repo: 'o/r', branch: 'topic', pr: '1' },
  ])('rejects incomplete or contradictory selector %#', async (options) => {
    await expect(
      runRetrospectiveFacts({ ...options, execute: makeExecutor().execute }),
    ).rejects.toThrow()
  })

  it('reports failed and malformed foreign GitHub responses, including raw evidence', async () => {
    const key = `gh pr view 49 --repo vouchington/tooling --json ${fields}`
    const failed = makeExecutor({ [key]: { ok: false, stderr: 'offline' } })
    const failedOutput = await runRetrospectiveFacts({
      pr: '49',
      repo: 'vouchington/tooling',
      raw: true,
      execute: failed.execute,
    })
    expect(failedOutput).toContain('PR state: gh failed')
    expect(failedOutput).toContain('stderr:\noffline')

    const malformed = makeExecutor({ [key]: { stdout: '{not-json' } })
    const malformedOutput = await runRetrospectiveFacts({
      pr: '49',
      repo: 'vouchington/tooling',
      execute: malformed.execute,
    })
    expect(malformedOutput).toContain('PR state: unavailable')
  })

  it.each([
    ['release', 'no (GitHub reports PR MERGED into release)'],
    [undefined, 'unavailable'],
  ])(
    'does not treat a foreign PR merged into %s as merged to main',
    async (baseRefName, expected) => {
      const key = `gh pr view 49 --repo vouchington/tooling --json ${fields}`
      const { calls, execute } = makeExecutor({
        [key]: { stdout: JSON.stringify({ ...pr, number: 49, baseRefName }) },
      })
      const output = await runRetrospectiveFacts({
        pr: '49',
        repo: 'vouchington/tooling',
        execute,
      })
      expect(output).toContain(`Merged to main: ${expected}`)
      expect(calls).toEqual([key])
    },
  )

  it('resolves a named branch from origin when no local branch exists', async () => {
    const { calls, execute } = makeExecutor({
      'git branch --show-current': { stdout: 'current' },
      'git rev-parse --verify --quiet refs/heads/topic': { ok: false },
      'git fetch origin topic:refs/remotes/origin/topic': { ok: true },
      'git rev-parse --verify --quiet refs/remotes/origin/topic': { ok: true },
      'git rev-list --count origin/main..origin/topic': { stdout: '2' },
      'git diff --name-only origin/main...origin/topic': { stdout: 'src/a.mts' },
    })
    const output = await runRetrospectiveFacts({ branch: 'topic', execute })
    expect(output).toContain('Commits ahead of origin/main: 2')
    expect(output).toContain('Fetch note: origin/main refreshed; origin/topic refreshed')
    expect(calls).toContain('git diff --name-only origin/main...origin/topic')
  })

  it('returns unavailable branch facts when neither named ref exists', async () => {
    const { calls, execute } = makeExecutor({
      'git branch --show-current': { stdout: 'current' },
      'git rev-parse --verify --quiet refs/heads/missing': { ok: false },
      'git fetch origin missing:refs/remotes/origin/missing': { ok: false },
    })
    const output = await runRetrospectiveFacts({ branch: 'missing', execute })
    expect(output).toContain('Commits ahead of origin/main: unavailable')
    expect(calls).not.toContain('git rev-list --count origin/main..missing')
  })

  it('warns when origin/main contains the merge but local main does not', async () => {
    const gh = `gh pr view 123 --json ${fields}`
    const warnings: string[] = []
    const { execute } = makeExecutor({
      'git branch --show-current': { stdout: 'topic-branch' },
      [gh]: { stdout: JSON.stringify(pr) },
      'git status --porcelain --untracked-files=normal': { stdout: '' },
      'git reflog show origin/topic-branch': { stdout: '' },
      'git merge-base --is-ancestor abc123 origin/main': { ok: true },
      'git merge-base --is-ancestor abc123 main': { ok: false, exitCode: 1 },
    })
    const output = await runRetrospectiveFacts({
      pr: '123',
      execute,
      onWarning: warnings.push.bind(warnings),
    })
    expect(output).toContain('Merged to main: yes (origin/main contains abc123)')
    expect(warnings).toEqual([
      'Warning: local main lacks PR merge commit abc123, but origin/main contains it.',
    ])
  })

  it('reports a merged PR absent from origin/main', async () => {
    const gh = `gh pr view 123 --json ${fields}`
    const { execute } = makeExecutor({
      'git branch --show-current': { stdout: 'topic-branch' },
      [gh]: { stdout: JSON.stringify(pr) },
      'git status --porcelain --untracked-files=normal': { stdout: '' },
      'git reflog show origin/topic-branch': { stdout: '' },
      'git merge-base --is-ancestor abc123 origin/main': { ok: false, exitCode: 1 },
    })
    await expect(runRetrospectiveFacts({ pr: '123', execute })).resolves.toContain(
      'Merged to main: no (origin/main lacks abc123)',
    )
  })

  it('uses the shell boundary when no executor is supplied', async () => {
    vi.mocked(shell).mockResolvedValue({ ok: true, stdout: '', stderr: '' })
    await expect(runRetrospectiveFacts({ noPr: true })).resolves.toContain('PR: none')
    expect(shell).toHaveBeenCalled()
  })

  it('reports unknown merge-base failures as unavailable without a false local-main warning', async () => {
    const gh = `gh pr view 123 --json ${fields}`
    const warnings: string[] = []
    const { execute } = makeExecutor({
      'git branch --show-current': { stdout: 'topic-branch' },
      [gh]: { stdout: JSON.stringify(pr) },
      'git status --porcelain --untracked-files=normal': { stdout: '' },
      'git reflog show origin/topic-branch': { stdout: '' },
      'git merge-base --is-ancestor abc123 origin/main': { ok: false, exitCode: 2 },
    })
    await expect(
      runRetrospectiveFacts({ pr: '123', execute, onWarning: warnings.push.bind(warnings) }),
    ).resolves.toContain('Merged to main: unavailable')
    expect(warnings).toEqual([])
  })

  it('does not claim local main lacks a merge when that ancestry check fails unexpectedly', async () => {
    const gh = `gh pr view 123 --json ${fields}`
    const warnings: string[] = []
    const { execute } = makeExecutor({
      'git branch --show-current': { stdout: 'topic-branch' },
      [gh]: { stdout: JSON.stringify(pr) },
      'git status --porcelain --untracked-files=normal': { stdout: '' },
      'git reflog show origin/topic-branch': { stdout: '' },
      'git merge-base --is-ancestor abc123 origin/main': { ok: true },
      'git merge-base --is-ancestor abc123 main': { ok: false, exitCode: 2 },
    })
    await expect(
      runRetrospectiveFacts({ pr: '123', execute, onWarning: warnings.push.bind(warnings) }),
    ).resolves.toContain('Merged to main: yes (origin/main contains abc123)')
    expect(warnings).toEqual([])
  })

  it('reports an unavailable no-PR merge check when Git fails unexpectedly', async () => {
    const { execute } = makeExecutor({
      'git branch --show-current': { stdout: 'topic' },
      'git reflog show origin/topic': { stdout: '' },
      'git status --porcelain --untracked-files=normal': { stdout: '' },
      'git rev-list --count origin/main..topic': { stdout: '1' },
      'git diff --name-only origin/main...topic': { stdout: '' },
      'git merge-base --is-ancestor topic origin/main': { ok: false, exitCode: 2 },
    })
    await expect(runRetrospectiveFacts({ noPr: true, execute })).resolves.toContain(
      'Merged to main: unavailable',
    )
  })
})
