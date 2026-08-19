import { describe, expect, it } from 'vitest'

import {
  formatReleaseAgeFailure,
  isReleaseAgeViolation,
  parseReleaseAgeViolations,
} from './release-age.mts'

const minimumReleaseAge = 0

const REAL_LOG = `✗ Lockfile failed supply-chain policy check (1857 entries in 3.7s)
[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:
  undici@8.10.0 was published at 2026-08-03T15:06:33.000Z, within the minimumReleaseAge cutoff (2026-08-02T04:48:10.357Z)
`

const TRANSIENT_LOG = ' ERROR  GET http://127.0.0.1:1/pnpm: fetch failed\n'

describe('isReleaseAgeViolation', () => {
  it('matches a captured release-age failure log', () => {
    expect(isReleaseAgeViolation(REAL_LOG)).toBe(true)
  })

  it('does not match an ordinary transient network failure log', () => {
    expect(isReleaseAgeViolation(TRANSIENT_LOG)).toBe(false)
  })
})

describe('parseReleaseAgeViolations', () => {
  it('extracts package, publish timestamp, and cutoff from a real captured log', () => {
    expect(parseReleaseAgeViolations(REAL_LOG)).toEqual([
      {
        cutoff: '2026-08-02T04:48:10.357Z',
        packageSpec: 'undici@8.10.0',
        publishedAt: '2026-08-03T15:06:33.000Z',
      },
    ])
  })

  it('extracts every entry when pnpm reports more than one violation', () => {
    const multi = `[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 2 lockfile entries failed verification:
  undici@8.10.0 was published at 2026-08-03T15:06:33.000Z, within the minimumReleaseAge cutoff (2026-08-02T04:48:10.357Z)
  @fixture/dep@2.0.0 was published at 2026-08-03T16:00:00.000Z, within the minimumReleaseAge cutoff (2026-08-02T04:48:10.357Z)
`
    expect(parseReleaseAgeViolations(multi)).toHaveLength(2)
  })

  it('returns no entries when the token is present but no detail line parses', () => {
    expect(
      parseReleaseAgeViolations('[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] unexpected shape\n'),
    ).toEqual([])
  })
})

describe('formatReleaseAgeFailure', () => {
  it('computes the eligibility timestamp from the real minimumReleaseAge and links the policy doc', () => {
    const message = formatReleaseAgeFailure('ordinary persistent install', REAL_LOG)
    const eligibleAt = new Date(
      new Date('2026-08-03T15:06:33.000Z').getTime() + minimumReleaseAge * 60_000,
    ).toISOString()
    expect(message).toContain('ordinary persistent install failed')
    expect(message).toContain(
      `undici@8.10.0 published 2026-08-03T15:06:33.000Z, eligible at ${eligibleAt}`,
    )
    expect(message).toContain('pnpm minimumReleaseAge')
  })

  it('still reports terminal when the token is present but detail lines do not parse', () => {
    const message = formatReleaseAgeFailure(
      'install',
      '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] weird\n',
    )
    expect(message).toContain('(violation details were not present in the captured log)')
  })

  it('does not throw and still reports terminal when the log has no violations at all', () => {
    const message = formatReleaseAgeFailure('install', TRANSIENT_LOG)
    expect(message).toContain('(violation details were not present in the captured log)')
  })

  it('uses an explicit docs link', () => {
    expect(formatReleaseAgeFailure('install', REAL_LOG, 'https://example.test/docs')).toContain(
      'See https://example.test/docs.',
    )
  })

  it('omits eligibility when the publish timestamp is not a date', () => {
    const log = `[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION]
  undici@8.10.0 was published at not-a-date, within the minimumReleaseAge cutoff (2026-08-02T04:48:10.357Z)
`
    expect(formatReleaseAgeFailure('install', log)).toContain('undici@8.10.0 published not-a-date')
    expect(formatReleaseAgeFailure('install', log)).not.toContain('eligible at')
  })
})
