import { describe, expect, it } from 'vitest'

import {
  formatRequestProfileLine,
  parseRequestProfileLine,
  REQUEST_PROFILE_PREFIX,
} from './line.mts'

const summary = {
  totalQueries: 7,
  serialDepth: 3,
  repeats: [
    { annotation: 'a:b', count: 2 },
    { annotation: 'c', count: 4 },
  ],
}

describe('formatRequestProfileLine', () => {
  it('formats repeats', () => {
    expect(formatRequestProfileLine('GET /x', summary, { all: false })).toBe(
      '[pg-request-profile] route=GET /x queries=7 serialDepth=3 repeats=a:b(x2),c(x4)\n',
    )
  })

  it('skips clean requests unless all is set', () => {
    const clean = { totalQueries: 1, serialDepth: 1, repeats: [] }
    expect(formatRequestProfileLine('GET /x', clean, { all: false })).toBeNull()
    expect(formatRequestProfileLine('GET /x', clean, { all: true })).toBe(
      `${REQUEST_PROFILE_PREFIX} route=GET /x queries=1 serialDepth=1 repeats=none\n`,
    )
  })
})

describe('parseRequestProfileLine', () => {
  it('round-trips formatted lines', () => {
    const line = formatRequestProfileLine('POST /mcp tools/call t', summary, { all: false })!
    expect(parseRequestProfileLine(line)).toEqual({
      route: 'POST /mcp tools/call t',
      queries: 7,
      serialDepth: 3,
      repeats: summary.repeats,
    })
  })

  it('skips leading log noise and accepts none and empty repeats', () => {
    expect(
      parseRequestProfileLine(
        `12:00 info ${REQUEST_PROFILE_PREFIX} route=GET /x queries=1 serialDepth=1 repeats=none`,
      )?.repeats,
    ).toEqual([])
    expect(
      parseRequestProfileLine(
        `${REQUEST_PROFILE_PREFIX} route=GET /x queries=1 serialDepth=1 repeats=`,
      )?.repeats,
    ).toEqual([])
  })

  it('rejects lines without the prefix or with malformed fields', () => {
    expect(parseRequestProfileLine('nothing')).toBeUndefined()
    expect(parseRequestProfileLine(`${REQUEST_PROFILE_PREFIX} garbage`)).toBeUndefined()
    const head = `${REQUEST_PROFILE_PREFIX} route=GET /x queries=1 serialDepth=1 repeats=`
    expect(parseRequestProfileLine(`${head}a(x1)`)).toBeUndefined()
    expect(parseRequestProfileLine(`${head}a`)).toBeUndefined()
    expect(parseRequestProfileLine(`${head}a(x2),b`)).toBeUndefined()
    expect(parseRequestProfileLine(`${head} (x2)`)).toBeUndefined()
    expect(
      parseRequestProfileLine(
        `${REQUEST_PROFILE_PREFIX} route= queries=1 serialDepth=1 repeats=none`,
      ),
    ).toBeUndefined()
  })
})
