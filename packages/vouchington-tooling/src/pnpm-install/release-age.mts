import { readFileSync } from 'node:fs'

// pnpm's supply-chain policy check is permanent-until-timestamp, not transient: retrying an
// ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION cannot succeed before the flagged release ages past
// pnpm-workspace.yaml's minimumReleaseAge. Fail those attempts immediately instead of burning
// retries against a deterministic wall-clock gate.
const TOKEN = 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION'
// Targets pnpm's stable detail-line wording; if pnpm rephrases it, parseReleaseAgeViolations()
// falls back to an empty list and formatReleaseAgeFailure() still reports terminal (see below).
const DETAIL_LINE =
  /^\s*(?<packageSpec>\S+) was published at (?<publishedAt>\S+), within the minimumReleaseAge cutoff \((?<cutoff>\S+)\)\s*$/gm
const defaultDocsLink = process.env['PNPM_INSTALL_DOCS_URL'] ?? 'pnpm minimumReleaseAge'
// This module loads before `pnpm install` has ever run, so it cannot depend on a package pnpm
// would install — including yaml. minimumReleaseAge is a single top-level scalar, so a targeted
// line match avoids needing a YAML parser at all.
const MINIMUM_RELEASE_AGE_LINE = /^minimumReleaseAge:\s*(?<minutes>\d+)\s*(?:#.*)?$/m

export interface ReleaseAgeViolation {
  cutoff: string
  packageSpec: string
  publishedAt: string
}

/** Gate on the stable pnpm error code; detail-line shape is parsed best-effort separately. */
export function isReleaseAgeViolation(log: string): boolean {
  return log.includes(TOKEN)
}

export function parseReleaseAgeViolations(log: string): ReleaseAgeViolation[] {
  const violations: ReleaseAgeViolation[] = []
  for (const match of log.matchAll(DETAIL_LINE)) {
    const { cutoff, packageSpec, publishedAt } = match.groups ?? {}
    if (cutoff && packageSpec && publishedAt) violations.push({ cutoff, packageSpec, publishedAt })
  }
  return violations
}

function workspaceMinimumReleaseAgeMinutes(): number | undefined {
  try {
    const workspace = readFileSync(`${process.cwd()}/pnpm-workspace.yaml`, 'utf8')
    const minutes = MINIMUM_RELEASE_AGE_LINE.exec(workspace)?.groups?.minutes
    return minutes === undefined ? undefined : Number(minutes)
  } catch (error) {
    console.warn(`unable to read minimumReleaseAge from pnpm-workspace.yaml: ${String(error)}`)
    return undefined
  }
}

function eligibleAt(publishedAt: string, minutes: number | undefined): string | undefined {
  const published = new Date(publishedAt)
  if (minutes === undefined || Number.isNaN(published.getTime())) return undefined
  return new Date(published.getTime() + minutes * 60_000).toISOString()
}

export function formatReleaseAgeFailure(
  label: string,
  log: string,
  docsLink = defaultDocsLink,
): string {
  const violations = parseReleaseAgeViolations(log)
  const minutes = workspaceMinimumReleaseAgeMinutes()
  const lines =
    violations.length > 0
      ? violations.map((violation) => {
          const eligible = eligibleAt(violation.publishedAt, minutes)
          return `  ${violation.packageSpec} published ${violation.publishedAt}${eligible ? `, eligible at ${eligible}` : ''}`
        })
      : ['  (violation details were not present in the captured log)']
  return [
    `${label} failed: the lockfile has entries that violate pnpm's minimumReleaseAge supply-chain policy. This is not transient and will not pass until the flagged release ages past the cutoff:`,
    ...lines,
    `See ${docsLink}.`,
  ].join('\n')
}
