import { describe, expect, it } from 'vitest'
import { isPlainTextConfig, queryText, targetsStatement } from './fault-support.mts'

describe('queryText', () => {
  it('reads strings and text configs and ignores anything else', () => {
    expect(queryText('SELECT 1')).toBe('SELECT 1')
    expect(queryText({ text: 'SELECT 2' })).toBe('SELECT 2')
    expect(queryText({ name: 'no-text' })).toBe('')
    expect(queryText(null)).toBe('')
    expect(queryText(42)).toBe('')
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

describe('isPlainTextConfig', () => {
  it('accepts only a single plain config object', () => {
    expect(isPlainTextConfig([{ text: 'SELECT 1' }])).toBe(true)
    expect(isPlainTextConfig([{ text: 'SELECT 1' }, 'extra'])).toBe(false)
    expect(isPlainTextConfig([{ text: 'SELECT 1', callback: () => undefined }])).toBe(false)
    expect(isPlainTextConfig([Object.create(null, { text: { value: 'x' } })])).toBe(false)
  })
})
