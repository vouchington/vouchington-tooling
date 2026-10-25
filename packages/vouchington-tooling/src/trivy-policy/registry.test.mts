import { describe, expect, it } from 'vitest'

import {
  parseIgnoreRegistry,
  resolveOptions,
  validateIgnoreRegistry,
  type Ignore,
} from './index.mts'

const now = new Date('2026-10-31T12:00:00.000Z')
const date = (days: number): string => {
  const copy = new Date(now)
  copy.setUTCDate(copy.getUTCDate() + days)
  return copy.toISOString().slice(0, 10)
}
const purl = (name: string) => `pkg:deb/debian/${name}@8.0.1-1?arch=amd64`
const valid = {
  id: 'CVE-2026-0001',
  purls: [purl('curl')],
  statement:
    'Not exploitable: package is not reachable. Cleanup: https://github.com/acme/app/issues/1',
  expired_at: date(14),
}
const check = (ignore: Ignore, options = {}) =>
  validateIgnoreRegistry({ vulnerabilities: [ignore] }, { now, ...options })

describe('validateIgnoreRegistry', () => {
  it('accepts exact OS purls, encoded names and an empty list', () => {
    expect(() => check(valid)).not.toThrow()
    expect(() => validateIgnoreRegistry({ vulnerabilities: [] }, { now })).not.toThrow()
    for (const name of ['libstdc++6', 'libstdc%2B%2B6'])
      expect(() => check({ ...valid, purls: [purl(name)] })).not.toThrow()
  })

  it('parses unquoted dates written by hand', () => {
    const registry = parseIgnoreRegistry(
      `vulnerabilities:\n  - id: ${valid.id}\n    purls:\n      - ${purl('curl')}\n    statement: ${JSON.stringify(valid.statement)}\n    expired_at: ${valid.expired_at}\n`,
    )
    expect(() => validateIgnoreRegistry(registry, { now })).not.toThrow()
  })

  it('requires a vulnerability array and an identifier', () => {
    expect(() => validateIgnoreRegistry({}, { now })).toThrow('vulnerabilities must be an array')
    expect(() => validateIgnoreRegistry(parseIgnoreRegistry(''), { now })).toThrow(
      'vulnerabilities must be an array',
    )
    expect(() => check({ ...valid, id: ' ' })).toThrow(
      'vulnerabilities[0].id must be a vulnerability identifier',
    )
  })

  it('rejects inexact or non-OS purls', () => {
    const message = 'vulnerabilities[0].purls must contain exact versioned package purls'
    for (const purls of [
      [],
      'pkg:deb/x/y@1',
      ['pkg:npm/sharp@0.35.0'],
      ['pkg:deb/debian/curl'],
      [purl('libstdc%2G6')],
      [purl('libstdc%6')],
      [1],
    ])
      expect(() => check({ ...valid, purls })).toThrow(message)
  })

  it('requires a rationale and a cleanup issue URL', () => {
    const message =
      'vulnerabilities[0].statement must give exploitability rationale and cleanup issue URL'
    for (const statement of [
      'Exploitable: reaches package. Cleanup: https://github.com/acme/app/issues/1',
      'Not exploitable: unreachable. Cleanup: https://example.com/issues/1',
      'Not exploitable: unreachable. Cleanup: https://github.com/acme/app/issues/0',
      undefined,
    ])
      expect(() => check({ ...valid, statement })).toThrow(message)
  })

  it('restricts the cleanup URL to the configured prefix', () => {
    const options = { cleanupUrlPrefix: 'https://github.com/acme/app/issues/' }
    expect(() => check(valid, options)).not.toThrow()
    expect(() =>
      check(
        { ...valid, statement: String(valid.statement).replace('acme/app', 'acme/other') },
        options,
      ),
    ).toThrow('cleanup issue URL')
    expect(() =>
      check(
        { ...valid, statement: String(valid.statement).replace('github.com', 'githubXcom') },
        options,
      ),
    ).toThrow('cleanup issue URL')
  })

  it('requires a near-term UTC calendar expiry', () => {
    const calendar = 'vulnerabilities[0].expired_at must be a UTC calendar date'
    for (const expired_at of ['2020-01-01T00:00:00Z', '2026-02-31', 20261201, undefined])
      expect(() => check({ ...valid, expired_at })).toThrow(calendar)
    expect(() => check({ ...valid, expired_at: date(0) })).toThrow('must be after today')
    expect(() => check({ ...valid, expired_at: date(30) })).not.toThrow()
    expect(() => check({ ...valid, expired_at: date(31) })).toThrow(
      'must be no more than 30 days away',
    )
    expect(() => check({ ...valid, expired_at: date(8) }, { maxExpiryDays: 7 })).toThrow(
      'must be no more than 7 days away',
    )
  })
})

describe('resolveOptions', () => {
  it('fills defaults', () => {
    expect(resolveOptions()).toMatchObject({
      ignoreFile: '.trivyignore.yaml',
      findingsExitCodeEnv: 'TRIVY_FINDINGS_EXIT_CODE',
      minGates: 2,
      minSboms: 2,
      maxExpiryDays: 30,
    })
  })
})
