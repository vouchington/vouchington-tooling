// Resolves the highest stable pnpm release of one major whose publish time is at least
// MIN_AGE_HOURS old and writes it to $GITHUB_OUTPUT as `version`. One request, no retry.
import { appendFileSync } from 'node:fs'

const major = process.env.PNPM_MAJOR ?? '12'
const minAgeHours = Number(process.env.MIN_AGE_HOURS ?? '24')
const registry = process.env.PNPM_REGISTRY_URL ?? 'https://registry.npmjs.org/pnpm'
const stable = new RegExp(`^${major}\\.(\\d+)\\.(\\d+)$`, 'u')

function fail(message) {
  console.error(`::error::${message}`)
  process.exit(1)
}

let packument
try {
  const response = await fetch(registry, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) fail(`${registry} responded ${response.status}`)
  packument = await response.json()
} catch (error) {
  fail(`Could not fetch ${registry}: ${error instanceof Error ? error.message : String(error)}`)
}

const cutoff = Date.now() - minAgeHours * 3_600_000
const candidates = Object.keys(packument.versions ?? {})
  .map((version) => ({ version, match: stable.exec(version) }))
  .filter(({ version, match }) => {
    const published = Date.parse(packument.time?.[version] ?? '')
    return match !== null && Number.isFinite(published) && published <= cutoff
  })
  .toSorted(
    (a, b) => Number(b.match[1]) - Number(a.match[1]) || Number(b.match[2]) - Number(a.match[2]),
  )

if (candidates.length === 0) {
  fail(`No stable pnpm ${major}.x release is at least ${minAgeHours}h old.`)
}
const { version } = candidates[0]
console.log(`Resolved pnpm ${version} (published ${packument.time[version]})`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`)
