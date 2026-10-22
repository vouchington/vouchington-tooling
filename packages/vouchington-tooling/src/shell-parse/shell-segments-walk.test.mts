import { describe, expect, it } from 'vitest'

import { splitCommandSegments, tokenizeShellWordsDetailed, walkUnquotedShell } from './index.mts'

function unquotedQuestionMarks(text: string): number[] {
  const found: number[] = []
  walkUnquotedShell(
    text,
    () => ({}),
    (index) => {
      if (text[index] === '?') found.push(index)
      return undefined
    },
  )
  return found
}

describe('splitCommandSegments', () => {
  it('keeps quoted operators inside their word', () => {
    expect(splitCommandSegments('echo ";" "a && b" | cat')).toEqual([
      ['echo', ';', 'a && b'],
      ['cat'],
    ])
  })

  it('keeps a quoted operator argument next to a real operator', () => {
    expect(splitCommandSegments('echo "|" | cat')).toEqual([['echo', '|'], ['cat']])
    expect(splitCommandSegments('echo "&" & cat')).toEqual([['echo', '&'], ['cat']])
  })

  it('splits on && and || and drops empty segments', () => {
    expect(splitCommandSegments('a && b || c ;; d')).toEqual([['a'], ['b'], ['c'], ['d']])
  })

  it('keeps parentheses inside words', () => {
    expect(splitCommandSegments('echo $(git status) (x)')).toEqual([
      ['echo', '$(git', 'status)', '(x)'],
    ])
  })
})

describe('tokenizer options', () => {
  it('marks operators only when asked', () => {
    expect(tokenizeShellWordsDetailed('a;b\nc')).toEqual([
      { expandable: false, value: 'a' },
      { expandable: false, value: ';' },
      { expandable: false, value: 'b' },
      { expandable: false, value: '\n' },
      { expandable: false, value: 'c' },
    ])
    expect(tokenizeShellWordsDetailed('a&&b\n', { markOperators: true })).toEqual([
      { expandable: false, value: 'a' },
      { expandable: false, operator: true, value: '&&' },
      { expandable: false, value: 'b' },
      { expandable: false, operator: true, value: '\n' },
    ])
  })

  it('emits parentheses as operators unless kept', () => {
    expect(tokenizeShellWordsDetailed('(a)').map((word) => word.value)).toEqual(['(', 'a', ')'])
    expect(tokenizeShellWordsDetailed('(a)', { keepParentheses: true })).toEqual([
      { expandable: false, value: '(a)' },
    ])
  })
})

describe('walkUnquotedShell', () => {
  it('skips quoted, escaped, and commented characters', () => {
    expect(unquotedQuestionMarks(`a? "b?" 'c?' d\\? # e?`)).toEqual([1])
  })

  it('does not treat a quoted ${VAR} as unquoting a later question mark', () => {
    expect(unquotedQuestionMarks('"x${VAR}y?z=1"')).toEqual([])
  })

  it('tracks each command substitution level independently', () => {
    expect(unquotedQuestionMarks('"$(echo "a?" b?)" c?')).toEqual([14, 19])
    expect(unquotedQuestionMarks('$(a ((b?)) c?) d?')).toEqual([7, 12, 16])
  })

  it('lets the visitor skip ahead', () => {
    const seen: number[] = []
    walkUnquotedShell(
      'abcdef',
      () => ({}),
      (index) => {
        seen.push(index)
        return index === 1 ? 4 : undefined
      },
    )
    expect(seen).toEqual([0, 1, 4, 5])
  })

  it('treats a mid-word # as an ordinary character', () => {
    expect(unquotedQuestionMarks('a#b?')).toEqual([3])
    expect(unquotedQuestionMarks('#?')).toEqual([])
  })
})
