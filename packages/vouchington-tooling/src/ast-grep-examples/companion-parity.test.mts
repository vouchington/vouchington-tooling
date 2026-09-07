import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareAstGrepCompanions } from './companion-parity.mts'

function withRules(files: Record<string, string>, run: (rules: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'ast-grep-companions-'))
  const rules = join(root, 'rules')
  mkdirSync(rules)
  try {
    for (const [file, contents] of Object.entries(files)) {
      const target = join(rules, file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, contents)
    }
    run(rules)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

describe('AST-grep companion parity', () => {
  it('compares recursively paired YAML documents without considering object key order', () => {
    withRules(
      {
        'ignored.txt': 'not a rule\n',
        'nested/rule.yml': 'id: rule\nrule:\n  all:\n    - pattern: one\n    - pattern: two\n',
        'nested/rule-tsx.yaml': 'rule:\n  all:\n    - pattern: one\n    - pattern: two\nid: rule\n',
      },
      (rules) => expect(compareAstGrepCompanions({ rules })).toEqual([]),
    )
  })

  it('returns deterministic JSON-pointer differences for every semantic field', () => {
    withRules(
      {
        'rule.yml': 'message: base\nunknown: { z: 1, a: 2 }\n',
        'rule-tsx.yml': 'message: companion\nunknown: { z: 3, a: 4 }\n',
      },
      (rules) =>
        expect(compareAstGrepCompanions({ rules })).toEqual([
          {
            baseFile: 'rule.yml',
            companionFile: 'rule-tsx.yml',
            path: '/message',
            base: 'base',
            companion: 'companion',
          },
          {
            baseFile: 'rule.yml',
            companionFile: 'rule-tsx.yml',
            path: '/unknown/a',
            base: 2,
            companion: 4,
          },
          {
            baseFile: 'rule.yml',
            companionFile: 'rule-tsx.yml',
            path: '/unknown/z',
            base: 1,
            companion: 3,
          },
        ]),
    )
  })

  it('lets callers normalize intentional differences explicitly', () => {
    withRules(
      {
        'rule.yml': 'language: TypeScript\nrule: { pattern: foo }\n',
        'rule-tsx.yml': 'language: Tsx\nrule: { pattern: foo }\n',
      },
      (rules) =>
        expect(
          compareAstGrepCompanions({
            rules,
            normalize: (document) => {
              const { language: _language, ...semanticRule } = document as Record<string, unknown>
              return semanticRule
            },
          }),
        ).toEqual([]),
    )
  })

  it('preserves array ordering and normalizer context', () => {
    withRules(
      {
        'rule.yml': 'examples: [one]\n',
        'rule-tsx.yml': 'examples: []\n',
      },
      (rules) => {
        const contexts: string[] = []
        expect(compareAstGrepCompanions({ rules })).toMatchObject([{ path: '/examples/0' }])
        expect(
          compareAstGrepCompanions({
            rules,
            normalize: (document, context) => {
              contexts.push(`${context.role}:${context.file}`)
              return document
            },
          }),
        ).toMatchObject([{ path: '/examples/0' }])
        expect(contexts).toEqual(['base:rule.yml', 'companion:rule-tsx.yml'])
      },
    )
  })

  it('fails closed on missing and duplicate companion pairs', () => {
    withRules({ 'rule-tsx.yml': 'id: rule\n' }, (rules) =>
      expect(() => compareAstGrepCompanions({ rules })).toThrow(
        'rule-tsx.yml: missing base companion',
      ),
    )
    withRules(
      {
        'rule.yml': 'id: rule\n',
        'rule.yaml': 'id: rule\n',
        'rule-tsx.yml': 'id: rule\n',
      },
      (rules) =>
        expect(() => compareAstGrepCompanions({ rules })).toThrow(
          'rule-tsx.yml: duplicate base companions: rule.yaml, rule.yml',
        ),
    )
    withRules(
      {
        'rule.yml': 'id: rule\n',
        'rule-tsx.yml': 'id: rule\n',
        'rule-tsx.yaml': 'id: rule\n',
      },
      (rules) =>
        expect(() => compareAstGrepCompanions({ rules })).toThrow(
          'rule: duplicate companion rules: rule-tsx.yaml, rule-tsx.yml',
        ),
    )
  })

  it('fails closed on malformed YAML and symbolic-link paths', () => {
    withRules({ 'rule.yml': 'id: [not valid\n', 'rule-tsx.yml': 'id: rule\n' }, (rules) =>
      expect(() => compareAstGrepCompanions({ rules })).toThrow('rule.yml: invalid YAML'),
    )
    withRules({ 'rule.yml': 'id: rule\n', 'rule-tsx.yml': 'id: rule\n' }, (rules) => {
      symlinkSync(join(rules, 'rule.yml'), join(rules, 'linked.yml'))
      expect(() => compareAstGrepCompanions({ rules })).toThrow(
        'linked.yml: symbolic links are not allowed',
      )
    })
  })

  it('rejects invalid suffixes and root links', () => {
    withRules({ 'rule.yml': 'id: rule\n', 'rule-tsx.yml': 'id: rule\n' }, (rules) => {
      expect(() => compareAstGrepCompanions({ rules, companionSuffix: '' })).toThrow(
        'companionSuffix must be a non-empty filename suffix',
      )
      const linkedRules = join(dirname(rules), 'linked-rules')
      symlinkSync(rules, linkedRules)
      expect(() => compareAstGrepCompanions({ rules: linkedRules })).toThrow(
        'rules: symbolic links are not allowed',
      )
    })
  })
})
