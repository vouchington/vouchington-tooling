import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { astGrepExamplesArguments, runAstGrepExamples } from './index.mts'

describe('ast-grep-examples', () => {
  it('runs native examples and replays files/ignores with project language globs', () => {
    const root = mkdtempSync(join(tmpdir(), 'ast-grep-examples-'))
    try {
      const rules = join(root, 'rules')
      mkdirSync(rules)
      writeFileSync(join(root, 'sgconfig.yml'), 'languageGlobs:\n  JavaScript: ["**/*.custom"]\n')
      writeFileSync(
        join(rules, 'no-foo.yml'),
        'id: no-foo\nlanguage: JavaScript\nrule: { pattern: foo }\nfiles: ["**/*.custom"]\nignores: ["ignored.custom"]\nexamples:\n  - { code: foo, isValid: false, file: found.custom }\n  - { code: foo, isValid: true, file: ignored.custom }\n',
      )
      const calls: string[][] = []
      expect(
        runAstGrepExamples({
          rules,
          config: join(root, 'sgconfig.yml'),
          execute: (args) => {
            calls.push([...args])
            if (args[0] === 'test') return { status: 0 }
            return { status: 0, stdout: JSON.stringify([{ file: 'found.custom' }]) }
          },
        }),
      ).toBe(0)
      expect(calls.map((args) => args[0])).toEqual(['test', 'scan'])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('validates required options and example coverage', () => {
    expect(astGrepExamplesArguments({ rules: 'rules', config: 'sgconfig.yml' })).toContain('test')
    expect(() => astGrepExamplesArguments({ rules: '', config: 'sgconfig.yml' })).toThrow(
      '--rules requires a path',
    )
  })

  it('rejects example paths that escape the temporary rule directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'ast-grep-examples-'))
    try {
      const rules = join(root, 'rules')
      mkdirSync(rules)
      writeFileSync(join(root, 'sgconfig.yml'), 'languageGlobs:\n  JavaScript: ["**/*.js"]\n')
      writeFileSync(
        join(rules, 'no-foo.yml'),
        'id: no-foo\nlanguage: JavaScript\nrule: { pattern: foo }\nexamples:\n  - { code: foo, isValid: false, file: ../outside.js }\n  - { code: bar, isValid: true, file: valid.js }\n',
      )
      expect(() => runAstGrepExamples({ rules, config: join(root, 'sgconfig.yml') })).toThrow(
        'must stay within the temporary rule directory',
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
