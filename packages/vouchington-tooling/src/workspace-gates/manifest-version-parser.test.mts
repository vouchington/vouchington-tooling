import { describe, expect, it } from 'vitest'

import { findExpectations } from './manifest-version-parser.mts'

describe('manifest-version expectation parser', () => {
  it('finds whitespace-led, negated matchers after regex and string literals with parentheses', () => {
    const source = [
      "const quoted = 'expect(not a call)'",
      'const pattern = /[()]/',
      'expect(manifest.dependencies)',
      "  .not.toHaveProperty('example-dependency', '^1.2.3')",
    ].join('\n')

    expect(findExpectations(source)).toEqual([
      {
        expression: 'manifest.dependencies',
        expected: "'example-dependency', '^1.2.3'",
        index: source.indexOf('expect(manifest'),
      },
    ])
  })

  it('ignores comments, division, malformed calls, and unterminated literals', () => {
    const source = [
      'const quotient = left / right',
      "// expect(manifest.dependencies).toBe('^1.2.3')",
      "/* expect(manifest.dependencies).toBe('^1.2.3') */",
      'expect(value',
      'expect(value).toHaveLength(1)',
      'expect(value).toBe(',
      'expect value',
      "'unterminated",
    ].join('\n')

    expect(findExpectations(source)).toEqual([])
  })

  it('handles regex and string escape boundaries without missing a later assertion', () => {
    const source = [
      '/\\(escaped\\)/.test(value)',
      "const escaped = 'it\\'s safe'",
      "expect \n(value).toBe('ok')",
      '/unterminated',
      '/* unterminated',
    ].join('\n')

    expect(findExpectations(source)).toEqual([
      {
        expression: 'value',
        expected: "'ok'",
        index: source.indexOf('expect \n(value)'),
      },
    ])
    expect(findExpectations('/')).toEqual([])
    expect(findExpectations("const broken = /unfinished\nexpect(value).toBe('ok')")).toHaveLength(1)
  })

  it('recognizes an optional matcher chain', () => {
    expect(findExpectations("expect(value)?.toBe('ok')")).toHaveLength(1)
  })
})
