import { describe, expect, it } from 'vitest'
import { localFacts } from './local.mts'
import type { CommandExecutor, CommandResult } from './shared.mts'

function executor(responses: Record<string, Partial<CommandResult>> = {}) {
  const calls: string[] = []
  const execute: CommandExecutor = async (command, args) => {
    const key = [command, ...args].join(' ')
    calls.push(key)
    return { ok: true, stdout: '', stderr: '', ...responses[key] }
  }
  return { calls, execute }
}

describe('local retrospective facts branches', () => {
  it('handles an empty local branch, no GitHub request, and a failed GitHub request', async () => {
    const noPr = executor({ 'git branch --show-current': { stdout: '' } })
    await expect(localFacts({ noPr: true }, noPr.execute)).resolves.toContain('Branch: unavailable')
    expect(noPr.calls).not.toContainEqual(expect.stringMatching(/^gh /))

    const failedGh = executor({
      'git branch --show-current': { stdout: 'topic' },
      'gh pr view 1 --json number,state,mergedAt,mergeCommit,changedFiles,files,commits,headRefName':
        {
          ok: false,
        },
      'git status --porcelain --untracked-files=normal': { stdout: '' },
    })
    const output = await localFacts({ pr: '1' }, failedGh.execute)
    expect(output).toContain('PR state: gh failed')
    expect(output).toContain('Branch: unavailable')
  })

  it('handles origin fallback, failed local history calls, and a failed working tree read', async () => {
    const { execute } = executor({
      'git fetch origin main:refs/remotes/origin/main': { ok: false },
      'git rev-parse --verify --quiet refs/remotes/origin/main': { ok: true },
      'git branch --show-current': { stdout: 'topic' },
      'git rev-list --count origin/main..HEAD': { stdout: '2' },
      'git diff --name-only origin/main...HEAD': { stdout: 'a/file\n' },
      'git reflog show origin/topic': { ok: false },
      'git status --porcelain --untracked-files=normal': { ok: false },
    })
    const output = await localFacts({ noPr: true }, execute)
    expect(output).toContain('Fetch note: using existing local origin/main ref after failed fetch')
    expect(output).toContain('Remote updates for origin/topic: unavailable')
    expect(output).toContain('Push-like updates for origin/topic: unavailable')
    expect(output).toContain('Working tree changes: unavailable')
  })

  it.each([
    ['topic', 'topic', false],
    ['other', 'topic', true],
    ['unavailable', 'topic', false],
  ])(
    'scopes an explicit branch only when local or PR head differs (%s, %s)',
    async (head, local, scoped) => {
      const { calls, execute } = executor({
        'git branch --show-current': { stdout: local },
        'gh pr view 1 --json number,state,mergedAt,mergeCommit,changedFiles,files,commits,headRefName':
          {
            stdout: JSON.stringify({ headRefName: head }),
          },
        'git rev-parse --verify --quiet refs/heads/topic': { ok: true },
      })
      const output = await localFacts({ pr: '1', branch: 'topic' }, execute)
      expect(output).toContain(
        scoped ? 'Working tree changes: n/a (scoped to topic)' : 'Working tree changes: 0',
      )
      expect(calls.includes('git status --porcelain --untracked-files=normal')).toBe(!scoped)
    },
  )

  it('refuses a stale remote branch when its refresh fails', async () => {
    const { calls, execute } = executor({
      'git branch --show-current': { stdout: 'current' },
      'git rev-parse --verify --quiet refs/heads/topic': { ok: false },
      'git fetch origin topic:refs/remotes/origin/topic': { ok: false, exitCode: 128 },
    })
    const output = await localFacts({ branch: 'topic', raw: true }, execute)
    expect(output).toContain('Commits ahead of origin/main: unavailable')
    expect(output).toContain('$ git fetch origin topic:refs/remotes/origin/topic')
    expect(calls).not.toContain('git rev-parse --verify --quiet refs/remotes/origin/topic')
  })

  it('requires the refreshed remote ref to exist before using it', async () => {
    const { execute } = executor({
      'git branch --show-current': { stdout: 'current' },
      'git rev-parse --verify --quiet refs/heads/topic': { ok: false },
      'git fetch origin topic:refs/remotes/origin/topic': { ok: true },
      'git rev-parse --verify --quiet refs/remotes/origin/topic': { ok: false },
    })
    await expect(localFacts({ branch: 'topic' }, execute)).resolves.toContain(
      'Commits ahead of origin/main: unavailable',
    )
  })
})
