import { chmodSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { parseAstGrepRuleArgs, runAstGrepRule } from './index.mts'

describe('ast-grep-rule', () => {
  it('parses a rule id and preserves passthrough arguments', () => {
    expect(parseAstGrepRuleArgs(['--', 'no-danger', '--json'])).toEqual({
      ruleId: 'no-danger',
      passthrough: ['--json'],
    })
  })

  it('rejects missing, option-shaped, and path-shaped rule ids', () => {
    for (const args of [[], ['--fix'], ['../outside'], ['bad/name']]) {
      expect(() => parseAstGrepRuleArgs(args)).toThrow()
    }
  })

  it('runs a configured executable with the selected rule', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ast-grep-rule-'))
    mkdirSync(join(root, 'rules'))
    writeFileSync(join(root, 'rules', 'safe.yml'), 'id: safe\n')
    expect(
      await runAstGrepRule({
        args: ['safe'],
        cwd: root,
        rulesDirectory: 'rules',
        executable: '/usr/bin/true',
        defaultScanArguments: [],
      }),
    ).toBe(0)
  })

  it('uses default paths and maps signal termination to failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ast-grep-rule-'))
    mkdirSync(join(root, 'ast-grep-rules'))
    writeFileSync(join(root, 'ast-grep-rules', 'safe.yml'), 'id: safe\n')
    const executable = join(root, 'terminate.sh')
    writeFileSync(executable, '#!/bin/sh\nkill -TERM $$\n')
    chmodSync(executable, 0o700)
    const defaultExecutable = join(root, 'node_modules', '@ast-grep', 'cli', 'ast-grep')
    mkdirSync(join(root, 'node_modules', '@ast-grep', 'cli'), { recursive: true })
    writeFileSync(defaultExecutable, '#!/bin/sh\nexit 0\n')
    chmodSync(defaultExecutable, 0o700)
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    try {
      await expect(runAstGrepRule({ args: ['safe'], executable })).resolves.toBe(1)
      await expect(runAstGrepRule({ args: ['safe'] })).resolves.toBe(0)
    } finally {
      cwd.mockRestore()
    }
  })

  it('rejects missing rules and symlinks that escape the rule directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ast-grep-rule-'))
    mkdirSync(join(root, 'rules'))
    writeFileSync(join(root, 'outside.yml'), 'id: outside\n')
    symlinkSync(join(root, 'outside.yml'), join(root, 'rules', 'escape.yml'))
    expect(() =>
      runAstGrepRule({
        args: ['missing'],
        cwd: root,
        rulesDirectory: 'rules',
        executable: '/usr/bin/true',
      }),
    ).toThrow('Unknown AST-grep rule id')
    expect(() =>
      runAstGrepRule({
        args: ['escape'],
        cwd: root,
        rulesDirectory: 'rules',
        executable: '/usr/bin/true',
      }),
    ).toThrow('outside the rules directory')
  })
})
