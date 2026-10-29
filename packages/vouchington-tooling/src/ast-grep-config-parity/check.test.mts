import { describe, expect, it } from 'vitest'
import {
  checkAstGrepConfigParity,
  DEFAULT_LANGUAGE_GLOBS,
  type CheckAstGrepConfigParityOptions,
} from './index.mts'

const SGCONFIG = `ruleDirs:
  - ast-grep-rules
languageGlobs:
  Tsx:
    - '**/*.ts'
    - '**/*.mts'
    - '**/*.cts'
    - '**/*.tsx'
`

function options(
  overrides: Partial<CheckAstGrepConfigParityOptions> = {},
): CheckAstGrepConfigParityOptions {
  return {
    sgconfig: { name: 'sgconfig.yml', source: SGCONFIG },
    localRuleDir: 'ast-grep-rules',
    localRules: [{ path: 'local-rule.yml', source: 'id: local\nlanguage: Tsx\n' }],
    packRulePaths: ['manifest-rule.yml', 'nested/deep-rule.yml'],
    ...overrides,
  }
}

const reasons = (o: CheckAstGrepConfigParityOptions) =>
  checkAstGrepConfigParity(o).map((offender) => offender.reason)

describe('checkAstGrepConfigParity', () => {
  it('exports the default globs', () => {
    expect(DEFAULT_LANGUAGE_GLOBS).toEqual({
      Tsx: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.tsx'],
    })
  })

  it('passes a matching configuration', () => {
    expect(checkAstGrepConfigParity(options())).toEqual([])
  })

  describe('ruleDirs', () => {
    it.each([
      ['an extra directory', 'ruleDirs: [ast-grep-rules, pack]'],
      ['a different directory', 'ruleDirs: [other]'],
      ['a missing key', 'other: 1'],
    ])('flags %s', (_label, head) => {
      const source = `${head}\nlanguageGlobs:\n  Tsx: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.tsx']\n`
      const offenders = checkAstGrepConfigParity(options({ sgconfig: { name: 's.yml', source } }))
      expect(offenders).toHaveLength(1)
      expect(offenders[0]).toMatchObject({ name: 's.yml', reason: 'rule-dirs' })
    })

    it('reports a missing key as undefined', () => {
      const [offender] = checkAstGrepConfigParity(
        options({ sgconfig: { name: 's.yml', source: 'x: 1' } }),
      )
      expect(offender?.detail).toBe('ruleDirs is undefined, expected ["ast-grep-rules"]')
    })
  })

  describe('languageGlobs', () => {
    const withGlobs = (globs: string) =>
      options({ sgconfig: { name: 's.yml', source: `ruleDirs: [ast-grep-rules]\n${globs}` } })

    it.each([
      ['missing', ''],
      ['reordered globs', "languageGlobs:\n  Tsx: ['**/*.tsx', '**/*.ts', '**/*.mts', '**/*.cts']"],
      [
        'an extra language',
        "languageGlobs:\n  Tsx: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.tsx']\n  Json: ['*.json']",
      ],
      ['a missing glob', "languageGlobs:\n  Tsx: ['**/*.ts']"],
    ])('flags %s', (_label, globs) => {
      expect(reasons(withGlobs(globs))).toEqual(['language-globs'])
    })

    it('accepts a custom expected mapping', () => {
      const custom = options({
        sgconfig: {
          name: 's.yml',
          source: 'ruleDirs: [ast-grep-rules]\nlanguageGlobs:\n  Json: ["*.json"]',
        },
        expectedLanguageGlobs: { Json: ['*.json'] },
      })
      expect(reasons(custom)).toEqual([])
    })
  })

  describe('copied pack rules', () => {
    it('flags a local rule with the same relative path', () => {
      const offenders = checkAstGrepConfigParity(
        options({ localRules: [{ path: 'nested/deep-rule.yml', source: 'language: Tsx' }] }),
      )
      expect(offenders).toEqual([
        expect.objectContaining({ name: 'nested/deep-rule.yml', reason: 'copied-pack-rule' }),
      ])
    })

    it('flags a copy whose directory layout differs by basename', () => {
      expect(
        reasons(options({ localRules: [{ path: 'sub/deep-rule.yml', source: 'language: Tsx' }] })),
      ).toEqual(['copied-pack-rule'])
      expect(
        reasons(options({ localRules: [{ path: 'manifest-rule.yml', source: 'language: Tsx' }] })),
      ).toEqual(['copied-pack-rule'])
    })

    it('passes when no path or basename matches', () => {
      expect(reasons(options({ packRulePaths: ['other.yml'] }))).toEqual([])
    })
  })

  describe('empty local rules', () => {
    it('flags an empty local rule list', () => {
      const offenders = checkAstGrepConfigParity(options({ localRules: [] }))
      expect(offenders).toEqual([
        expect.objectContaining({ name: 'ast-grep-rules', reason: 'empty-local-rules' }),
      ])
    })
  })

  describe('rule language', () => {
    it('flags a different language', () => {
      const offenders = checkAstGrepConfigParity(
        options({ localRules: [{ path: 'a.yml', source: 'language: Json' }] }),
      )
      expect(offenders).toEqual([
        expect.objectContaining({
          name: 'a.yml',
          reason: 'rule-language',
          detail: 'document 0: language is "Json", expected "Tsx"',
        }),
      ])
    })

    it('flags a missing language', () => {
      const offenders = checkAstGrepConfigParity(
        options({ localRules: [{ path: 'a.yml', source: 'id: x' }] }),
      )
      expect(offenders[0]?.detail).toBe('document 0: language is undefined, expected "Tsx"')
    })

    it('flags a scalar rule document as missing language', () => {
      expect(reasons(options({ localRules: [{ path: 'a.yml', source: 'text' }] }))).toEqual([
        'rule-language',
      ])
    })

    it('honors an exception, in both directions', () => {
      const base = { languageExceptions: { 'data/json-rule.yml': 'Json' } }
      const ok = options({
        ...base,
        localRules: [{ path: 'data/json-rule.yml', source: 'language: Json' }],
      })
      expect(reasons(ok)).toEqual([])
      const bad = options({
        ...base,
        localRules: [{ path: 'data/json-rule.yml', source: 'language: Tsx' }],
      })
      expect(reasons(bad)).toEqual(['rule-language'])
    })

    it('honors a custom default language', () => {
      const custom = options({
        defaultLanguage: 'Json',
        localRules: [{ path: 'a.yml', source: 'language: Json' }],
      })
      expect(reasons(custom)).toEqual([])
    })

    it('flags a stale exception naming no local rule', () => {
      const offenders = checkAstGrepConfigParity(
        options({ languageExceptions: { 'gone.yml': 'Json' } }),
      )
      expect(offenders).toEqual([
        expect.objectContaining({ name: 'gone.yml', reason: 'rule-language' }),
      ])
    })

    it('does not treat inherited object keys as exceptions', () => {
      const rule = { path: 'toString', source: 'language: Tsx' }
      expect(reasons(options({ localRules: [rule] }))).toEqual([])
    })
  })

  describe('tsx companions', () => {
    it.each(['a-tsx.yml', 'nested/b-tsx.yaml'])('flags %s', (path) => {
      const offenders = checkAstGrepConfigParity(
        options({ localRules: [{ path, source: 'language: Tsx' }] }),
      )
      expect(offenders).toEqual([expect.objectContaining({ name: path, reason: 'tsx-companion' })])
    })

    it.each(['tsx.yml', 'a-tsx-extra.yml', 'a_tsx.yml'])('allows %s', (path) => {
      expect(reasons(options({ localRules: [{ path, source: 'language: Tsx' }] }))).toEqual([])
    })
  })

  describe('multi-document rule files', () => {
    const rules = (source: string) => options({ localRules: [{ path: 'multi.yml', source }] })

    it('passes when every document has the expected language', () => {
      expect(reasons(rules('id: a\nlanguage: Tsx\n---\nid: b\nlanguage: Tsx\n'))).toEqual([])
    })

    it('flags a wrong second document with its index', () => {
      const offenders = checkAstGrepConfigParity(
        rules('id: a\nlanguage: Tsx\n---\nid: b\nlanguage: Json\n'),
      )
      expect(offenders).toEqual([
        {
          name: 'multi.yml',
          reason: 'rule-language',
          detail: 'document 1: language is "Json", expected "Tsx"',
        },
      ])
    })

    it('reports each mismatching document', () => {
      const offenders = checkAstGrepConfigParity(rules('id: a\n---\nid: b\n'))
      expect(offenders.map((offender) => offender.detail)).toEqual([
        'document 0: language is undefined, expected "Tsx"',
        'document 1: language is undefined, expected "Tsx"',
      ])
    })

    it('applies a listed exception to every document', () => {
      const multi = options({
        languageExceptions: { 'multi.yml': 'Json' },
        localRules: [{ path: 'multi.yml', source: 'language: Json\n---\nlanguage: Json\n' }],
      })
      expect(reasons(multi)).toEqual([])
    })

    it.each(['', '# only a comment\n'])('treats %j as a missing language', (source) => {
      const offenders = checkAstGrepConfigParity(rules(source))
      expect(offenders).toEqual([
        expect.objectContaining({ name: 'multi.yml', reason: 'rule-language' }),
      ])
    })

    it('flags invalid-yaml when any document is invalid', () => {
      const offenders = checkAstGrepConfigParity(
        rules('language: Tsx\n---\na: [unterminated\n---\nlanguage: Json\n'),
      )
      expect(offenders).toEqual([
        expect.objectContaining({ name: 'multi.yml', reason: 'invalid-yaml' }),
      ])
    })
  })

  describe('invalid YAML', () => {
    it('flags invalid sgconfig and skips its other checks', () => {
      const offenders = checkAstGrepConfigParity(
        options({ sgconfig: { name: 'sgconfig.yml', source: 'a: [unterminated' } }),
      )
      expect(offenders).toHaveLength(1)
      expect(offenders[0]).toMatchObject({ name: 'sgconfig.yml', reason: 'invalid-yaml' })
    })

    it('flags an invalid local rule without a language offender', () => {
      const offenders = checkAstGrepConfigParity(
        options({ localRules: [{ path: 'bad.yml', source: 'a: [unterminated' }] }),
      )
      expect(offenders).toHaveLength(1)
      expect(offenders[0]).toMatchObject({ name: 'bad.yml', reason: 'invalid-yaml' })
    })
  })
})
