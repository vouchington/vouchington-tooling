import { describe, expect, it } from 'vitest'
import { runRetrospectiveFacts, type CommandExecutor, type CommandResult } from './index.mts'

const fields = 'number,state,mergedAt,mergeCommit,changedFiles,files,commits,headRefName'
const pr = {
  number: 123,
  state: 'MERGED',
  mergedAt: '2026-05-31T20:00:00Z',
  mergeCommit: { oid: 'abc123' },
  changedFiles: 2,
  files: [{ path: 'dev/file.mts' }, { path: 'docs/file.md' }],
  commits: [{}, {}, {}],
  headRefName: 'topic-branch',
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
    ['MERGED', 'yes (GitHub reports PR MERGED)'],
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
      'git rev-list --count origin/main..HEAD': { stdout: '1\n' },
      'git diff --name-only origin/main...HEAD': { ok: false, stderr: 'bad diff' },
      'git status --porcelain --untracked-files=normal': { stdout: '' },
      'git reflog show origin/feature': { stdout: '' },
      'git merge-base --is-ancestor HEAD origin/main': { stdout: '' },
    })
    const output = await runRetrospectiveFacts({ noPr: true, execute })
    expect(output).toContain('Merged to main: yes (origin/main contains HEAD)')
    expect(output).toContain('Files changed from origin/main: unavailable')
    expect(output).toContain('Top-level dirs changed: unavailable')
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
    expect(output).toContain(
      "Commits ahead of origin/main: 100+ (gh's commits list caps at 100; actual count may be higher)",
    )
    expect(output).toContain(
      'Files changed from origin/main: 150 (partial: gh returned 1 of 150 changed files)',
    )
    expect(output).toContain(
      'Top-level dirs changed: root (partial: gh returned 1 of 150 changed files)',
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
})
