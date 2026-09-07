import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { compareAstGrepCompanions } from './companion-parity.mts'
import type {
  AstGrepCompanionContext,
  AstGrepCompanionDifference,
  AstGrepCompanionParityOptions,
} from './index.mts'

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
    run(realpathSync(rules))
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

describe('AST-grep companion parity', () => {
  it('exports the complete public companion parity type contract from the subpath', () => {
    expectTypeOf<AstGrepCompanionParityOptions>().toMatchTypeOf<{ rules: string }>()
    expectTypeOf<AstGrepCompanionContext>().toMatchTypeOf<{
      file: string
      role: 'base' | 'companion'
    }>()
    expectTypeOf<AstGrepCompanionDifference>().toMatchTypeOf<{
      base: unknown
      baseFile: string
      companion: unknown
      companionFile: string
      path: string
    }>()
  })

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

  it('fails closed on YAML aliases before comparison can traverse or report a cyclic graph', () => {
    const cyclic = 'rule: &rule { self: *rule }\n'
    withRules({ 'rule.yml': cyclic, 'rule-tsx.yml': cyclic }, (rules) =>
      expect(() => compareAstGrepCompanions({ rules })).toThrow('rule.yml: invalid YAML'),
    )
    withRules({ 'rule.yml': 'rule: { pattern: one }\n', 'rule-tsx.yml': cyclic }, (rules) =>
      expect(() => compareAstGrepCompanions({ rules })).toThrow('rule-tsx.yml: invalid YAML'),
    )
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

  it('rejects supplied rule paths with symlink or reparse-point ancestors', () => {
    withRules({}, (rules) => {
      const root = dirname(rules)
      const physicalAncestor = join(root, 'physical')
      const physicalRules = join(physicalAncestor, 'rules')
      mkdirSync(physicalRules, { recursive: true })
      writeFileSync(join(physicalRules, 'rule.yml'), 'id: rule\n')
      writeFileSync(join(physicalRules, 'rule-tsx.yml'), 'id: rule\n')
      const redirectedAncestor = join(root, 'redirected')
      symlinkSync(
        physicalAncestor,
        redirectedAncestor,
        process.platform === 'win32' ? 'junction' : 'dir',
      )

      expect(() => compareAstGrepCompanions({ rules: join(redirectedAncestor, 'rules') })).toThrow(
        'rules: symbolic links are not allowed',
      )
    })
  })

  it('uses explicit code-unit ordering for discovered rule paths', () => {
    withRules(
      {
        'ä.yml': 'message: base\n',
        'ä-tsx.yml': 'message: companion\n',
        'z.yml': 'message: base\n',
        'z-tsx.yml': 'message: companion\n',
      },
      (rules) =>
        expect(compareAstGrepCompanions({ rules }).map(({ baseFile }) => baseFile)).toEqual([
          'z.yml',
          'ä.yml',
        ]),
    )
  })
})
