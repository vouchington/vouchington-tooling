import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
        'id: no-foo\nlanguage: JavaScript\nrule: { pattern: foo }\nfiles: ["**/*.custom"]\nignores: ["ignored.custom"]\nexamples:\n  - { code: foo, isValid: false, file: found.custom }\n  - { code: bar, isValid: true, file: found.custom }\n  - { code: baz, isValid: true, file: ignored.custom }\n',
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

  it('requires language globs in the ast-grep configuration', () => {
    const root = mkdtempSync(join(tmpdir(), 'ast-grep-examples-'))
    try {
      const rules = join(root, 'rules')
      mkdirSync(rules)
      writeFileSync(join(root, 'sgconfig.yml'), '{}\n')
      writeFileSync(
        join(rules, 'no-foo.yml'),
        'id: no-foo\nlanguage: JavaScript\nrule: { pattern: foo }\nexamples:\n  - { code: foo, isValid: false, file: invalid.js }\n  - { code: bar, isValid: true, file: valid.js }\n',
      )
      expect(() => runAstGrepExamples({ rules, config: join(root, 'sgconfig.yml') })).toThrow(
        'missing languageGlobs',
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
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

  it('uses the default executor for successful native tests', () => {
    const root = mkdtempSync(join(tmpdir(), 'ast-grep-examples-'))
    try {
      const rules = join(root, 'rules')
      const executable = join(root, 'ast-grep')
      mkdirSync(rules)
      writeFileSync(join(root, 'sgconfig.yml'), 'languageGlobs:\n  JavaScript: ["**/*.js"]\n')
      writeFileSync(
        join(rules, 'no-foo.yml'),
        'id: no-foo\nlanguage: JavaScript\nrule: { pattern: foo }\nexamples:\n  - { code: foo, isValid: false, file: invalid.js }\n  - { code: bar, isValid: true, file: valid.js }\n',
      )
      writeFileSync(executable, '#!/bin/sh\nexit 0\n')
      chmodSync(executable, 0o755)
      expect(runAstGrepExamples({ rules, config: join(root, 'sgconfig.yml'), executable })).toBe(0)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('reports a default-executor spawn failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'ast-grep-examples-'))
    try {
      const rules = join(root, 'rules')
      mkdirSync(rules)
      writeFileSync(join(root, 'sgconfig.yml'), 'languageGlobs:\n  JavaScript: ["**/*.js"]\n')
      writeFileSync(
        join(rules, 'no-foo.yml'),
        'id: no-foo\nlanguage: JavaScript\nrule: { pattern: foo }\nexamples:\n  - { code: foo, isValid: false, file: invalid.js }\n  - { code: bar, isValid: true, file: valid.js }\n',
      )
      expect(() =>
        runAstGrepExamples({
          rules,
          config: join(root, 'sgconfig.yml'),
          executable: join(root, 'missing-ast-grep'),
        }),
      ).toThrow('ast-grep failed to spawn')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects unsafe rule ids before writing native tests', () => {
    const root = mkdtempSync(join(tmpdir(), 'ast-grep-examples-'))
    try {
      const rules = join(root, 'rules')
      mkdirSync(rules)
      writeFileSync(join(root, 'sgconfig.yml'), 'languageGlobs:\n  JavaScript: ["**/*.js"]\n')
      writeFileSync(
        join(rules, 'unsafe.yml'),
        'id: "no/foo"\nlanguage: JavaScript\nrule: { pattern: foo }\nexamples:\n  - { code: foo, isValid: false, file: invalid.js }\n  - { code: bar, isValid: true, file: valid.js }\n',
      )
      expect(() =>
        runAstGrepExamples({
          rules,
          config: join(root, 'sgconfig.yml'),
          execute: () => ({ status: 0 }),
        }),
      ).toThrow('rule id must be a filesystem-safe name')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('requires both valid and invalid examples', () => {
    for (const [name, examples] of [
      ['missing-valid', '{ code: foo, isValid: false, file: invalid.js }'],
      ['missing-invalid', '{ code: foo, isValid: true, file: valid.js }'],
    ]) {
      const root = mkdtempSync(join(tmpdir(), `ast-grep-examples-${name}-`))
      try {
        const rules = join(root, 'rules')
        mkdirSync(rules)
        writeFileSync(join(root, 'sgconfig.yml'), 'languageGlobs:\n  JavaScript: ["**/*.js"]\n')
        writeFileSync(
          join(rules, 'no-foo.yml'),
          `id: no-foo\nlanguage: JavaScript\nrule: { pattern: foo }\nexamples:\n  - ${examples}\n`,
        )
        expect(() => runAstGrepExamples({ rules, config: join(root, 'sgconfig.yml') })).toThrow(
          'examples require valid and invalid cases',
        )
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  it('rejects examples with empty code or file fields', () => {
    for (const [name, invalidExample] of [
      ['empty-code', '{ code: "", isValid: false, file: invalid.js }'],
      ['empty-file', '{ code: foo, isValid: false, file: "" }'],
    ]) {
      const root = mkdtempSync(join(tmpdir(), `ast-grep-examples-${name}-`))
      try {
        const rules = join(root, 'rules')
        mkdirSync(rules)
        writeFileSync(join(root, 'sgconfig.yml'), 'languageGlobs:\n  JavaScript: ["**/*.js"]\n')
        writeFileSync(
          join(rules, 'no-foo.yml'),
          `id: no-foo\nlanguage: JavaScript\nrule: { pattern: foo }\nexamples:\n  - ${invalidExample}\n  - { code: bar, isValid: true, file: valid.js }\n`,
        )
        expect(() => runAstGrepExamples({ rules, config: join(root, 'sgconfig.yml') })).toThrow(
          'examples require non-empty code and file',
        )
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  it('rejects a nonzero native test result', () => {
    const root = mkdtempSync(join(tmpdir(), 'ast-grep-examples-'))
    try {
      const rules = join(root, 'rules')
      mkdirSync(rules)
      writeFileSync(join(root, 'sgconfig.yml'), 'languageGlobs:\n  JavaScript: ["**/*.js"]\n')
      writeFileSync(
        join(rules, 'no-foo.yml'),
        'id: no-foo\nlanguage: JavaScript\nrule: { pattern: foo }\nexamples:\n  - { code: foo, isValid: false, file: invalid.js }\n  - { code: bar, isValid: true, file: valid.js }\n',
      )
      expect(() =>
        runAstGrepExamples({
          rules,
          config: join(root, 'sgconfig.yml'),
          execute: () => ({ status: 1, stderr: 'native failure' }),
        }),
      ).toThrow('native failure')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects a failed scoped scan and a mismatched scan result', () => {
    const makeRun = (result: { status: number; stderr?: string; stdout?: string }) => {
      const root = mkdtempSync(join(tmpdir(), 'ast-grep-examples-'))
      const rules = join(root, 'rules')
      mkdirSync(rules)
      writeFileSync(join(root, 'sgconfig.yml'), 'languageGlobs:\n  JavaScript: ["**/*.js"]\n')
      writeFileSync(
        join(rules, 'no-foo.yml'),
        'id: no-foo\nlanguage: JavaScript\nrule: { pattern: foo }\nfiles: ["**/*.js"]\nignores: ["ignored.js"]\nexamples:\n  - { code: foo, isValid: false, file: found.js }\n  - { code: bar, isValid: true, file: found.js }\n  - { code: baz, isValid: true, file: ignored.js }\n',
      )
      try {
        return runAstGrepExamples({
          rules,
          config: join(root, 'sgconfig.yml'),
          execute: (args) => (args[0] === 'test' ? { status: 0 } : result),
        })
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }

    expect(() => makeRun({ status: 2, stderr: 'scan failure' })).toThrow(
      'ast-grep scan failed (exit 2): scan failure',
    )
    expect(() => makeRun({ status: 2 })).toThrow('ast-grep scan failed (exit 2):')
    expect(() => makeRun({ status: 0, stdout: '[]' })).toThrow(
      'expected found.js to produce a finding',
    )
    expect(() =>
      makeRun({
        status: 0,
        stdout: JSON.stringify([{ file: 'found.js' }, { file: 'ignored.js' }]),
      }),
    ).toThrow('expected ignored.js not to produce a finding')
  })
})
