import { describe, expect, it } from 'vitest'

import { runSwiftSemanticEqualCommand } from '../cli/commands/swift-semantic-equal.mts'
import { runSwiftSemanticEqualCli } from './cli.mts'
import { normalizeSwiftSource } from './normalize.mts'

describe('normalizeSwiftSource', () => {
  it('ignores comments and insignificant whitespace', () => {
    expect(normalizeSwiftSource('let  x = 1 // note\n')).toBe('letx=1')
    expect(normalizeSwiftSource('let x = 1 /* inner */ + 2')).toBe('letx=1+2')
    expect(normalizeSwiftSource('/* nested /* comment */ still */let y=2')).toBe('lety=2')
    expect(normalizeSwiftSource('let x = 1 // eof')).toBe('letx=1')
    expect(normalizeSwiftSource('/x/')).toBe('/x/')
  })

  it('preserves string and regex literals including their internal spaces', () => {
    expect(normalizeSwiftSource('let s = "a b"')).toBe('lets="a b"')
    expect(normalizeSwiftSource('let s = """\n  hi\n  """')).toBe('lets="""\n  hi\n  """')
    expect(normalizeSwiftSource('let s = #"a b"#')).toBe('lets=#"a b"#')
    expect(normalizeSwiftSource('let s = "a\\"b"')).toBe('lets="a\\"b"')
    expect(normalizeSwiftSource('let s = "unterminated')).toBe('lets="unterminated')
    expect(normalizeSwiftSource('let r = /a\\/b/')).toBe('letr=/a\\/b/')
    expect(normalizeSwiftSource('let r = /unterminated')).toBe('letr=/unterminated')
  })

  it('does not treat a division slash as a regex', () => {
    expect(normalizeSwiftSource('let n = 1 / 2')).toBe('letn=1/2')
  })
})

describe('runSwiftSemanticEqualCli', () => {
  it('returns 0 when normalized sources match', () => {
    const gitShow = ((_cmd: string, args: readonly string[]) =>
      String(args[1]).startsWith('base:')
        ? 'let  x = 1\n'
        : 'let x=1 // same\n') as typeof import('node:child_process').execFileSync
    expect(runSwiftSemanticEqualCli(['base', 'head', 'App.swift'], gitShow)).toBe(0)
  })

  it('returns 1 for argument errors, missing files, or a real source change', () => {
    expect(runSwiftSemanticEqualCli(['base', 'head'])).toBe(1)
    expect(runSwiftSemanticEqualCommand(['base', 'head'])).toBe(1)
    expect(runSwiftSemanticEqualCli(['base', 'head', 'App.ts'])).toBe(1)
    const gitShow = ((_cmd: string, args: readonly string[]) =>
      String(args[1]).startsWith('base:')
        ? 'let x = 1\n'
        : 'let x = 2\n') as typeof import('node:child_process').execFileSync
    expect(runSwiftSemanticEqualCli(['base', 'head', 'App.swift'], gitShow)).toBe(1)
    expect(
      runSwiftSemanticEqualCli(['base', 'head', 'App.swift'], () => {
        throw new Error('missing')
      }),
    ).toBe(1)
  })
})
