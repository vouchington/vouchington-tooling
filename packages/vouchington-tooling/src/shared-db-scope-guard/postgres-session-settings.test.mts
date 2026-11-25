import { describe, expect, it } from 'vitest'
import {
  configureTestPostgresSessions,
  FAST_TEST_STATEMENT_TIMEOUT_MS,
  MAX_TEST_STATEMENT_TIMEOUT_MS,
  MIN_TEST_STATEMENT_TIMEOUT_MS,
  parseTestStatementTimeout,
} from './index.mts'

describe('parseTestStatementTimeout', () => {
  it('defaults to FAST_TEST_STATEMENT_TIMEOUT_MS and accepts valid integers within bounds', () => {
    expect(parseTestStatementTimeout(undefined)).toBe(FAST_TEST_STATEMENT_TIMEOUT_MS)
    expect(parseTestStatementTimeout(String(MIN_TEST_STATEMENT_TIMEOUT_MS))).toBe(
      MIN_TEST_STATEMENT_TIMEOUT_MS,
    )
    expect(parseTestStatementTimeout(String(MAX_TEST_STATEMENT_TIMEOUT_MS))).toBe(
      MAX_TEST_STATEMENT_TIMEOUT_MS,
    )
    expect(
      parseTestStatementTimeout('500', { defaultMs: 600, minMs: 100, maxMs: 900, envVarName: 'X' }),
    ).toBe(500)
  })

  it.each([
    '',
    '0',
    '999',
    '-1',
    '1.5',
    ' 1500',
    '1500 ',
    '01500',
    '1500ms',
    'NaN',
    'Infinity',
    '20001',
  ])('rejects invalid override %j', (raw) => {
    expect(() => parseTestStatementTimeout(raw)).toThrow(RangeError)
  })
})

describe('configureTestPostgresSessions', () => {
  it('preserves connection identity, existing options, extra settings, and is idempotent', () => {
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL:
        'postgres://fixture:secret@localhost/owned?options=-c%20application_name=fixture#frag',
      READ_DATABASE_URL: 'postgres://localhost/owned_read?sslmode=disable',
    }
    configureTestPostgresSessions(env, { extraSettings: { 'hnsw.ef_search': 1000 } })

    const primary = new URL(env.DATABASE_URL!)
    const read = new URL(env.READ_DATABASE_URL!)
    expect(primary.username).toBe('fixture')
    expect(primary.password).toBe('secret')
    expect(primary.pathname).toBe('/owned')
    expect(primary.hash).toBe('#frag')
    expect(primary.searchParams.get('options')).toBe(
      `-c application_name=fixture -c statement_timeout=${FAST_TEST_STATEMENT_TIMEOUT_MS} -c hnsw.ef_search=1000`,
    )
    expect(env.DATABASE_URL).not.toMatch(/[?&]options=[^&]*\+/u)

    expect(read.pathname).toBe('/owned_read')
    expect(read.searchParams.get('sslmode')).toBe('disable')
    expect(read.searchParams.get('options')).toBe(
      `-c jit=off -c statement_timeout=${FAST_TEST_STATEMENT_TIMEOUT_MS} -c hnsw.ef_search=1000`,
    )

    const oncePrimary = env.DATABASE_URL
    const onceRead = env.READ_DATABASE_URL
    configureTestPostgresSessions(env, { extraSettings: { 'hnsw.ef_search': 1000 } })
    expect(env.DATABASE_URL).toBe(oncePrimary)
    expect(env.READ_DATABASE_URL).toBe(onceRead)
  })

  it('preserves raw plus signs, multiple options parameters, empty options, and hostless socket URIs', () => {
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL:
        'postgres://localhost/owned?options=-c%20application_name=ignored&options=-c%20application_name=ci+1',
      READ_DATABASE_URL: 'postgresql://tester@/owned?host=%2Fvar%2Frun%2Fpostgresql&options',
    }
    configureTestPostgresSessions(env, { jitOff: false })

    expect(env.DATABASE_URL!.match(/[?&]options=/gu)).toHaveLength(1)
    expect(new URL(env.DATABASE_URL!).searchParams.get('options')).toContain(
      'application_name=ci+1',
    )
    expect(env.READ_DATABASE_URL).toMatch(
      /^postgresql:\/\/tester@\/owned\?host=%2Fvar%2Frun%2Fpostgresql&options=/u,
    )
    expect(env.READ_DATABASE_URL).not.toContain('jit%3Doff')
  })

  it('supports custom envKeys, jitOff=false on fresh URLs, and leaves unset env vars untouched', () => {
    const env: NodeJS.ProcessEnv = {
      CUSTOM_DB: 'postgres://localhost/custom',
      CUSTOM_TIMEOUT: '3500',
    }
    configureTestPostgresSessions(env, {
      envKeys: ['CUSTOM_DB', 'MISSING_DB'],
      statementTimeoutEnvVar: 'CUSTOM_TIMEOUT',
      jitOff: false,
    })
    expect(new URL(env.CUSTOM_DB!).searchParams.get('options')).toBe('-c statement_timeout=3500')
    expect('MISSING_DB' in env).toBe(false)

    // Default env argument with no DB URLs does not invent values.
    const empty: NodeJS.ProcessEnv = {}
    configureTestPostgresSessions(empty)
    expect(empty).toEqual({})
  })
})
