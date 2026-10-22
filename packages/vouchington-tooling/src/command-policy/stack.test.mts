import { describe, expect, it } from 'vitest'

import {
  configuredPullRequestBase,
  evaluateCommandPolicy,
  findHandRolledStackBaseBlock,
} from './index.mts'
import type { CommandPolicy, GitProbe, HookPayload, StackPolicy } from './index.mts'

function probe(overrides: Partial<GitProbe> = {}): GitProbe {
  return {
    currentBranch: () => 'feature',
    configValue: () => undefined,
    isAncestor: () => true,
    resolveRef: () => undefined,
    ...overrides,
  }
}

const bash = (command: string, cwd?: string): HookPayload => ({
  tool_input: { command, ...(cwd === undefined ? {} : { cwd }) },
})

function reason(command: string, stack: StackPolicy = {}, cwd = '/work'): string | null {
  const policy: CommandPolicy = { stack: { git: probe(), ...stack } }
  return (
    evaluateCommandPolicy(bash(command), policy, { automationContext: false, cwd })?.reason ?? null
  )
}

describe('stack workflow actions', () => {
  it.each([
    'gh stack add feat',
    'gh stack submit --auto',
    'gh stack submit --auto=true',
    'gh stack link a b',
    'gh stack checkout 12',
    'gh stack rebase --upstack',
    'gh stack view',
    'gh stack --help',
    'gh stack help',
    'gh stack help submit',
    'gh stack submit --help',
    'gh stack submit -h',
    '/usr/bin/gh-stack up 1',
    'gh extension exec stack up',
    'gh ext exec stack --help',
    'gh extensions exec',
    'gh extension exec stack',
    'gh pr view 1',
    'echo gh stack modify',
    'gh',
  ])('allows %j', (command) => {
    expect(reason(command)).toBeNull()
  })

  it('closes the allowlist', () => {
    expect(reason('gh stack modify')).toContain('allowlist is closed')
    expect(reason('gh stack trunk')).toContain('allowlist is closed')
    expect(reason('gh extension exec stack switch')).toContain('allowlist is closed')
    expect(reason('gh stack help bogus')).toContain('allowlist is closed')
    expect(reason('gh stack submit --help --foo')).toContain('interactive TUI')
  })

  it('requires a numeric checkout target', () => {
    expect(reason('gh stack checkout')).toContain('exactly one stack number')
    expect(reason('gh stack checkout my-branch')).toContain('exactly one')
    expect(reason('gh stack checkout 0')).toContain('exactly one')
    expect(reason('gh stack checkout 1 2')).toContain('exactly one')
  })

  it('keeps submit and link non-interactive and draft-first', () => {
    expect(reason('gh stack submit')).toContain('interactive TUI')
    expect(reason('gh stack submit --open', { draftFollowUp: 'call pr_update' })).toContain(
      'opened as draft first. Use `gh stack submit --auto`, then call pr_update.',
    )
    expect(reason('gh stack submit --open')).toMatch(/--auto`\.$/)
    expect(reason('gh stack link a b --open', { draftFollowUp: 'update the body' })).toContain(
      'without --open, then update the body.',
    )
    expect(reason('gh stack link a --open=false')).toBeNull()
  })

  it('requires a PR selector for stack merge', () => {
    expect(reason('gh stack merge')).toContain('requires a PR-number selector')
    expect(reason('gh stack merge --squash 12')).toContain('human decision')
  })

  it('appends guidance to each reason', () => {
    const guidance = 'See the stack skill.'
    expect(reason('gh stack modify', { guidance })).toMatch(/See the stack skill\.$/)
    expect(reason('gh stack checkout', { guidance })).toMatch(/skill\.$/)
  })

  it('applies no stack rules unless a stack policy is configured', () => {
    expect(
      evaluateCommandPolicy(bash('gh stack modify'), {}, { automationContext: false }),
    ).toBeNull()
  })

  it('reads gh through wrappers and nested scripts only', () => {
    expect(reason('env FOO=1 gh stack modify')).toContain('allowlist')
    expect(reason('bash -c "gh stack modify"')).toContain('allowlist')
    expect(reason('echo $(gh stack modify)')).toContain('allowlist')
    expect(reason('rg gh stack modify')).toBeNull()
    expect(reason('gh pr create --repo o/r > gh')).toBeNull()
  })
})

describe('stack init root guards', () => {
  it('requires the configured base branch', () => {
    expect(reason('gh stack init t --base feature')).toContain('must root on main')
    expect(reason('gh stack init t -b dev', { baseBranch: 'trunk' })).toContain('root on trunk')
    expect(reason('gh stack init t --base main')).toBeNull()
    expect(reason('gh stack init t --base=main')).toBeNull()
  })

  it('requires HEAD to descend from the remote base', () => {
    const git = probe({
      isAncestor: (_cwd, ancestor, descendant) => {
        expect([ancestor, descendant]).toEqual(['HEAD', 'upstream/trunk'])
        return false
      },
    })
    const text = reason('gh stack init t', { git, baseBranch: 'trunk', remote: 'upstream' })
    expect(text).toContain('already merged into upstream/trunk')
    expect(reason('gh stack init t', { git: probe({ isAncestor: () => undefined }) })).toBeNull()
  })

  it('rejects a stale local base branch and tolerates a missing one', () => {
    const refs: Record<string, string> = {
      'refs/heads/main': 'aaa',
      'refs/remotes/origin/main': 'bbb',
    }
    const git = probe({ resolveRef: (_cwd, ref) => refs[ref] })
    const text = reason('gh stack init t', { git, guidance: 'Ask the owner.' })
    expect(text).toContain('differs from origin/main')
    expect(text).toContain('git fetch origin main:main')
    expect(text).toMatch(/Ask the owner\.$/)
    refs['refs/heads/main'] = 'bbb'
    expect(reason('gh stack init t', { git })).toBeNull()
    delete refs['refs/heads/main']
    expect(reason('gh stack init t', { git })).toBeNull()
  })

  it('skips the checkout probes when the directory is unresolvable', () => {
    const git = probe({
      isAncestor: () => {
        throw new Error('must not probe')
      },
    })
    expect(reason('cd "$DIR" && gh stack init t', { git })).toBeNull()
    expect(
      reason('cd /a && gh stack init t', { git: probe({ isAncestor: (cwd) => cwd === '/a' }) }),
    ).toBeNull()
  })
})

describe('hand-rolled stack bases', () => {
  const resolved = { baseBranch: 'main', remote: 'origin', guidance: '', draftFollowUp: '' }

  it('blocks a PR aimed at an unmerged branch', () => {
    const git = probe()
    const block = findHandRolledStackBaseBlock('create', ['--base', 'feature'], '/w', {
      ...resolved,
      git,
      guidance: 'Use stacks.',
    })
    expect(block?.reason).toContain('PRs must target main')
    expect(block?.reason).toMatch(/Use stacks\.$/)
    expect(
      findHandRolledStackBaseBlock('edit', ['-B', 'main'], '/w', { ...resolved, git }),
    ).toBeNull()
    expect(findHandRolledStackBaseBlock('edit', [], '/w', { ...resolved, git })).toBeNull()
  })

  it('falls back to the branch-configured base for create only', () => {
    const git = probe({
      configValue: (_cwd, key) => (key === 'branch.feature.gh-merge-base' ? 'dev' : undefined),
    })
    expect(findHandRolledStackBaseBlock('create', [], '/w', { ...resolved, git })).not.toBeNull()
    expect(findHandRolledStackBaseBlock('new', [], '/w', { ...resolved, git })).not.toBeNull()
    expect(findHandRolledStackBaseBlock('edit', [], '/w', { ...resolved, git })).toBeNull()
    expect(findHandRolledStackBaseBlock('create', [], undefined, { ...resolved, git })).toBeNull()
    expect(configuredPullRequestBase('/w', git)).toBe('dev')
    expect(
      configuredPullRequestBase('/w', probe({ currentBranch: () => undefined })),
    ).toBeUndefined()
  })
})
