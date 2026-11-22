import { describe, expect, it } from 'vitest'
import pg from 'pg'
import {
  assertFaultOptions,
  isPlainTextConfig,
  matchesFaultTarget,
  queryText,
  targetsStatement,
} from './fault-support.mts'

describe('queryText', () => {
  it('reads strings and text configs and ignores anything else', () => {
    expect(queryText('SELECT 1')).toBe('SELECT 1')
    expect(queryText({ text: 'SELECT 2' })).toBe('SELECT 2')
    expect(queryText({ name: 'no-text' })).toBe('')
    expect(queryText(null)).toBe('')
    expect(queryText(42)).toBe('')
  })
})

describe('assertFaultOptions', () => {
  const pools = [new pg.Pool()]
  it('rejects an invalid close timeout before any client is leased', () => {
    for (const endTimeoutMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => assertFaultOptions('/* m */', { pools, endTimeoutMs })).toThrow('endTimeoutMs')
    expect(() => assertFaultOptions('/* m */', { pools, endTimeoutMs: 0 })).not.toThrow()
  })
})

describe('targetsStatement', () => {
  it('matches the marker and optional command', () => {
    expect(targetsStatement('  /* m */ INSERT INTO t', '/* m */', 'INSERT')).toBe(true)
    expect(targetsStatement('/* m */ SELECT 1', '/* m */', 'INSERT')).toBe(false)
    expect(targetsStatement('SELECT 1', '/* m */')).toBe(false)
    expect(targetsStatement('/* m */ insert into t', '/* m */', 'INSERT')).toBe(true)
  })
})

describe('matchesFaultTarget', () => {
  const marker = '/* m */'
  it('requires the marker, the command and matching bound values', () => {
    const query = { text: `${marker} SELECT 1`, values: ['a', 2] }
    expect(matchesFaultTarget(query, marker, {})).toBe(true)
    expect(matchesFaultTarget(query, marker, { command: 'SELECT' })).toBe(true)
    expect(matchesFaultTarget(query, marker, { command: 'INSERT' })).toBe(false)
    expect(
      matchesFaultTarget(query, marker, { matchesValues: (values) => values[0] === 'a' }),
    ).toBe(true)
    expect(
      matchesFaultTarget(query, marker, { matchesValues: (values) => values[0] === 'b' }),
    ).toBe(false)
  })

  it('hands an empty list to the predicate when the query binds no values', () => {
    const seen: (readonly unknown[])[] = []
    const matchesValues = (values: readonly unknown[]) => seen.push(values) > 0
    expect(matchesFaultTarget(`${marker} SELECT 1`, marker, { matchesValues })).toBe(true)
    expect(
      matchesFaultTarget({ text: `${marker} SELECT 1`, values: 'x' }, marker, { matchesValues }),
    ).toBe(true)
    expect(seen).toEqual([[], []])
  })
})

describe('isPlainTextConfig', () => {
  it('accepts only a single plain config object', () => {
    expect(isPlainTextConfig([{ text: 'SELECT 1' }])).toBe(true)
    expect(isPlainTextConfig([{ text: 'SELECT 1' }, 'extra'])).toBe(false)
    expect(isPlainTextConfig([{ text: 'SELECT 1', callback: () => undefined }])).toBe(false)
    expect(isPlainTextConfig([Object.create(null, { text: { value: 'x' } })])).toBe(false)
  })
})
