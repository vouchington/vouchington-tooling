import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { discoverAstGrepConfig, gitLsFiles } from './index.mts'

const roots: string[] = []

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

function tempRepo(files: Record<string, string>, untracked: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'ast-grep-parity-'))
  roots.push(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'user.name', 'Test')
  write(root, files)
  git(root, 'add', '.')
  write(root, untracked)
  return root
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const PACK = {
  'pack/rules/manifest-rule.yml': 'a',
  'pack/rules/nested/deep-rule.yaml': 'b',
  'pack/rules/notes.md': 'c',
}

describe('discoverAstGrepConfig', () => {
  const repo = tempRepo(
    {
      'sgconfig.yml': 'ruleDirs: [rules]\n',
      'rules/b.yml': 'bee',
      'rules/a.yaml': 'ay',
      'rules/nested/c.yml': 'sea',
      'rules/readme.md': 'not yaml',
      'other/d.yml': 'elsewhere',
      'rules-extra/e.yml': 'sibling directory',
    },
    { 'rules/untracked.yml': 'untracked', ...PACK },
  )

  it('returns sorted tracked rules (recursive) and the on-disk pack paths', async () => {
    expect(
      await discoverAstGrepConfig(repo, { localRuleDir: 'rules', packRulesDir: 'pack/rules' }),
    ).toEqual({
      sgconfig: { name: 'sgconfig.yml', source: 'ruleDirs: [rules]\n' },
      localRuleDir: 'rules',
      localRules: [
        { path: 'a.yaml', source: 'ay' },
        { path: 'b.yml', source: 'bee' },
        { path: 'nested/c.yml', source: 'sea' },
      ],
      packRulePaths: ['manifest-rule.yml', 'nested/deep-rule.yaml'],
    })
  })

  it('tolerates a trailing slash and an absolute pack directory', async () => {
    const input = await discoverAstGrepConfig(repo, {
      localRuleDir: 'rules/',
      packRulesDir: join(repo, 'pack/rules'),
    })
    expect(input.localRuleDir).toBe('rules')
    expect(input.packRulePaths).toHaveLength(2)
  })

  it('reads a custom sgconfig path', async () => {
    const input = await discoverAstGrepConfig(repo, {
      localRuleDir: 'rules',
      packRulesDir: 'pack/rules',
      sgconfigPath: 'other/d.yml',
    })
    expect(input.sgconfig).toEqual({ name: 'other/d.yml', source: 'elsewhere' })
  })

  it('throws on empty local discovery unless allowEmpty is set', async () => {
    const options = { localRuleDir: 'missing', packRulesDir: 'pack/rules' }
    await expect(discoverAstGrepConfig(repo, options)).rejects.toThrow(
      /No git-tracked ast-grep rule files/,
    )
    expect(
      (await discoverAstGrepConfig(repo, { ...options, allowEmpty: true })).localRules,
    ).toEqual([])
  })

  it('throws when the pack directory has no rule files, even with allowEmpty', async () => {
    const options = { localRuleDir: 'rules', packRulesDir: 'pack', allowEmpty: true }
    const empty = tempRepo(
      { 'sgconfig.yml': 'x', 'rules/a.yml': 'a' },
      { 'pack/readme.md': 'none' },
    )
    await expect(discoverAstGrepConfig(empty, options)).rejects.toThrow(
      /No ast-grep pack rule files/,
    )
  })

  it('rejects when the pack directory does not exist', async () => {
    await expect(
      discoverAstGrepConfig(repo, { localRuleDir: 'rules', packRulesDir: 'nope' }),
    ).rejects.toThrow(/ENOENT/)
  })

  it('accepts a replacement git runner', async () => {
    const calls: string[][] = []
    const input = await discoverAstGrepConfig(repo, {
      localRuleDir: 'rules',
      packRulesDir: 'pack/rules',
      listTrackedFiles: async (root, dir) => {
        calls.push([root, dir])
        return ['rules/b.yml', 'rules/readme.md', 'elsewhere/x.yml']
      },
    })
    expect(calls).toEqual([[repo, 'rules']])
    expect(input.localRules).toEqual([{ path: 'b.yml', source: 'bee' }])
  })

  it('sorts unordered runner output by code unit', async () => {
    const input = await discoverAstGrepConfig(repo, {
      localRuleDir: 'rules',
      packRulesDir: 'pack/rules',
      listTrackedFiles: async () => ['rules/nested/c.yml', 'rules/b.yml', 'rules/a.yaml'],
    })
    expect(input.localRules.map((rule) => rule.path)).toEqual(['a.yaml', 'b.yml', 'nested/c.yml'])
  })
})

describe('gitLsFiles', () => {
  it('lists tracked files under a directory only', async () => {
    const repo = tempRepo({ 'rules/a.yml': 'a', 'x/b.yml': 'b' }, { 'rules/c.yml': 'c' })
    expect(await gitLsFiles(repo, 'rules')).toEqual(['rules/a.yml'])
  })
})
