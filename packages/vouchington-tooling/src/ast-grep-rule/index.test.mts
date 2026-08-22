import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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
      }),
    ).toBe(0)
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
