import { parse } from 'yaml'

import { resolveOptions, type TrivyPolicyOptions } from './options.mts'

export type Ignore = Partial<Record<'expired_at' | 'id' | 'purls' | 'statement', unknown>>
export type IgnoreRegistry = { vulnerabilities?: Ignore[] }

const PART = String.raw`(?:[A-Za-z0-9._~+-]|%[0-9A-Fa-f]{2})+`
const VALUE = String.raw`(?:[A-Za-z0-9._~+:-]|%[0-9A-Fa-f]{2})+`
const QUALIFIER = String.raw`${PART}=${VALUE}`
const OS_PURL = new RegExp(
  String.raw`^pkg:(deb|apk|rpm)\/${PART}\/${PART}@${VALUE}(?:\?${QUALIFIER}(?:&${QUALIFIER})*)?$`,
)

// The registry's fields are all re-validated below with an explicit `typeof` check plus a regex,
// so the default YAML core schema is safe: a value it coerces to a non-string still fails.
export function parseIgnoreRegistry(source: string): IgnoreRegistry {
  return parse(source) as IgnoreRegistry
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function validateExpiry(expiredAt: unknown, prefix: string, options: TrivyPolicyOptions): void {
  const { now, maxExpiryDays } = resolveOptions(options)
  if (typeof expiredAt !== 'string' || !isCalendarDate(expiredAt))
    throw new Error(`${prefix}.expired_at must be a UTC calendar date`)
  const today = now.toISOString().slice(0, 10)
  if (expiredAt <= today) throw new Error(`${prefix}.expired_at must be after today`)
  const latest = new Date(`${today}T00:00:00Z`)
  latest.setUTCDate(latest.getUTCDate() + maxExpiryDays)
  if (expiredAt > latest.toISOString().slice(0, 10))
    throw new Error(`${prefix}.expired_at must be no more than ${maxExpiryDays} days away`)
}

export function validateIgnoreRegistry(
  registry: IgnoreRegistry,
  options: TrivyPolicyOptions = {},
): void {
  const vulnerabilities = registry?.vulnerabilities
  if (!Array.isArray(vulnerabilities)) throw new Error('vulnerabilities must be an array')
  const { cleanupUrlPattern } = resolveOptions(options)
  const statement = new RegExp(
    String.raw`^Not exploitable:\s*(?=\S).+?\.\s*Cleanup:\s*${cleanupUrlPattern}[1-9]\d*$`,
    'i',
  )
  for (const [index, ignore] of vulnerabilities.entries()) {
    const prefix = `vulnerabilities[${index}]`
    if (typeof ignore.id !== 'string' || ignore.id.trim() === '')
      throw new Error(`${prefix}.id must be a vulnerability identifier`)
    if (
      !Array.isArray(ignore.purls) ||
      ignore.purls.length === 0 ||
      ignore.purls.some((purl) => typeof purl !== 'string' || !OS_PURL.test(purl))
    )
      throw new Error(`${prefix}.purls must contain exact versioned package purls`)
    if (typeof ignore.statement !== 'string' || !statement.test(ignore.statement))
      throw new Error(
        `${prefix}.statement must give exploitability rationale and cleanup issue URL`,
      )
    validateExpiry(ignore.expired_at, prefix, options)
  }
}
