import { describe, expect, it } from 'vitest'
import { extractStaticStringPairs } from './static-string-pairs.mts'

describe('extractStaticStringPairs', () => {
  it('visits all literal arrays in source order without resolving exports or deduplicating', () => {
    expect(
      extractStaticStringPairs(`
        const local = [['items.id', 'reason'], ['items.id', 'reason']]
        export const exported = new Map([['other.id', 'other reason', 'extra']])
        function nested() { return [['nested.id', 'nested reason']] }
      `),
    ).toEqual([
      ['items.id', 'reason'],
      ['items.id', 'reason'],
      ['other.id', 'other reason'],
      ['nested.id', 'nested reason'],
    ])
  })

  it('preserves legacy ESTree field order across conditionals, parameter defaults, and loops', () => {
    expect(
      extractStaticStringPairs(`
        flag ? [['first.id', 'first']] : [['second.id', 'second']]
        function run(value = [['parameter.id', 'parameter']]) {
          return [['function_body.id', 'function body']]
        }
        for (const value of [['iterable.id', 'iterable']]) {
          const body = [['loop_body.id', 'loop body']]
        }
      `),
    ).toEqual([
      ['second.id', 'second'],
      ['first.id', 'first'],
      ['function_body.id', 'function body'],
      ['parameter.id', 'parameter'],
      ['loop_body.id', 'loop body'],
      ['iterable.id', 'iterable'],
    ])
  })

  it('decodes strings and retains empty strings without imposing a schema-key pattern', () => {
    expect(
      extractStaticStringPairs(String.raw`[['not a column', ''], ["a\u002eb", 'it\'s']];`),
    ).toEqual([
      ['not a column', ''],
      ['a.b', "it's"],
    ])
  })

  it('ignores comments, array patterns, templates, holes, spreads, and nonliteral elements', () => {
    expect(
      extractStaticStringPairs(`
        // ['comment.id', 'reason']
        const [first, second] = values
        const ignored = [
          ['one.id'], [, 'reason'], ['number.id', 1],
          [name, 'reason'], [...imported, 'reason'],
          [\`template.id\`, 'reason'], ['interpolated.id', \`reason \${name}\`],
        ]
      `),
    ).toEqual([])
  })

  it('traverses nested array expressions even inside ignored outer arrays', () => {
    expect(extractStaticStringPairs(`const data = [unknown, ['inner.id', 'reason']]`)).toEqual([
      ['inner.id', 'reason'],
    ])
  })

  it('accepts typed source without loading imports or executing expressions', () => {
    expect(
      extractStaticStringPairs(`
        import { missing } from 'module-that-does-not-exist'
        throw new Error('must not execute')
        export const pairs: readonly (readonly [string, string])[] = [['items.id', 'reason']]
      `),
    ).toEqual([['items.id', 'reason']])
  })

  it('rejects malformed source rather than returning a partial collection', () => {
    expect(() => extractStaticStringPairs(`const pairs = [['items.id', 'reason']`)).toThrow()
  })
})
