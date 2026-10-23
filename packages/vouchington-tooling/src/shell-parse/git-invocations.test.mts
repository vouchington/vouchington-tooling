import { describe, expect, it } from 'vitest'

import { gitInvocations, overridesConfig } from './index.mts'

const only = (command: string) => {
  const found = gitInvocations(command)
  expect(found).toHaveLength(1)
  return found[0]!
}

describe('gitInvocations', () => {
  it.each([
    `git -c "core.hooksPath=/tmp/hooks" push --force`,
    `git -c 'core.hooksPath=/tmp/hooks' push --force`,
    `git -c core.hooksPath=/tmp/hooks push --force`,
  ])('reads the subcommand behind a quoted -c: %s', (command) => {
    expect(only(command)).toEqual({
      args: ['--force'],
      configOverrides: [{ key: 'core.hooksPath', value: '/tmp/hooks' }],
      globalOptions: ['-c', 'core.hooksPath=/tmp/hooks'],
      subcommand: 'push',
    })
  })

  it('reads commit --amend after a -c', () => {
    const invocation = only(`git -c 'core.hooksPath=/x' commit --amend`)
    expect(invocation.subcommand).toBe('commit')
    expect(invocation.args).toEqual(['--amend'])
  })

  it.each([
    'CORE=1 git push',
    'env -i git push',
    'sudo git push',
    'sudo -u root git push',
    'sudo -E git push',
    'xargs git push',
    'xargs -n 1 git push',
    'timeout 5s git push',
    'timeout -s KILL 5 git push',
    'nice -n 5 git push',
    'sudo env FOO=1 git push',
    'sudo -- git push',
    '/usr/bin/git push',
    'a ; git push',
    'a | git push',
    'a || git push',
    'a\ngit push',
    '2>/dev/null git push',
  ])('finds git in command position: %s', (command) => {
    expect(gitInvocations(command).map((item) => item.subcommand)).toEqual(['push'])
  })

  it('reads a chained -C commit --amend', () => {
    expect(only('a && git -C /x commit --amend')).toEqual({
      args: ['--amend'],
      configOverrides: [],
      globalOptions: ['-C', '/x'],
      subcommand: 'commit',
    })
  })

  it('ignores git in argument position', () => {
    expect(gitInvocations(`printf '%s' 'git' '-c' x push`)).toEqual([])
    expect(gitInvocations('echo git push')).toEqual([])
  })

  it('ignores segments that run nothing readable', () => {
    for (const command of [
      'FOO=1',
      '',
      'a >',
      'sudo',
      'timeout',
      'timeout 5',
      'env -S x git push',
    ]) {
      expect(gitInvocations(command)).toEqual([])
    }
  })

  it('returns every invocation in order', () => {
    const commands = gitInvocations('git add . && git commit -m x; git push')
    expect(commands.map((item) => item.subcommand)).toEqual(['add', 'commit', 'push'])
  })

  it('skips attached, flag, and valued global options', () => {
    const invocation = only(
      'git --git-dir=/g --work-tree /w --namespace=n --exec-path --no-pager -p --bare ' +
        '--no-replace-objects --config-env=core.hooksPath=HOOKS status -s',
    )
    expect(invocation.subcommand).toBe('status')
    expect(invocation.args).toEqual(['-s'])
    expect(invocation.globalOptions).toHaveLength(10)
    expect(invocation.configOverrides).toEqual([{ key: 'core.hooksPath', value: 'HOOKS' }])
  })

  it('reads a separate --config-env value', () => {
    expect(only('git --config-env core.hooksPath=H push').configOverrides).toEqual([
      { key: 'core.hooksPath', value: 'H' },
    ])
  })

  it('keeps a -c key without a value', () => {
    expect(only('git -c core.pager push').configOverrides).toEqual([
      { key: 'core.pager', value: '' },
    ])
  })

  it('keeps equals signs inside a -c value', () => {
    expect(only('git -c a.b=c=d log').configOverrides).toEqual([{ key: 'a.b', value: 'c=d' }])
  })

  it('returns no subcommand for a bare git', () => {
    expect(only('git')).toEqual({
      args: [],
      configOverrides: [],
      globalOptions: [],
      subcommand: undefined,
    })
    expect(only('git -C /x').subcommand).toBeUndefined()
    expect(only('git --version').subcommand).toBeUndefined()
  })

  it('stops at a dangling value option', () => {
    const invocation = only('git -c')
    expect(invocation.subcommand).toBe('-c')
    expect(invocation.configOverrides).toEqual([])
  })

  it('ends arguments at the next separator', () => {
    expect(gitInvocations('git push --force && echo done')[0]!.args).toEqual(['--force'])
  })
})

describe('overridesConfig', () => {
  it('matches keys case-insensitively', () => {
    const invocation = only('git -c CORE.HOOKSPATH=/x commit')
    expect(overridesConfig(invocation, 'core.hooksPath')).toBe(true)
    expect(overridesConfig(invocation, 'core.editor')).toBe(false)
    expect(invocation.configOverrides[0]!.key).toBe('CORE.HOOKSPATH')
  })

  it('is false without any -c', () => {
    expect(overridesConfig(only('git push'), 'core.hooksPath')).toBe(false)
  })
})
