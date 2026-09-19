import type { PnpmLicenseReport } from './types.mts'

function getStringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`expected ${path} to be an array of strings`)
  }
  return value
}

export function parsePnpmLicenseReport(value: unknown): PnpmLicenseReport {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected a JSON object keyed by license expression')
  }

  const report = Object.create(null) as PnpmLicenseReport
  for (const [licenseExpression, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) {
      throw new Error(`expected license group ${JSON.stringify(licenseExpression)} to be an array`)
    }
    report[licenseExpression] = entries.map((entry, index) => {
      const path = `license group ${JSON.stringify(licenseExpression)} entry ${String(index)}`
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error(`expected ${path} to be an object`)
      }
      const { name, versions } = entry as Record<string, unknown>
      if (typeof name !== 'string') throw new Error(`expected ${path}.name to be a string`)
      if (versions === undefined) return { name }
      return { name, versions: getStringList(versions, `${path}.versions`) }
    })
  }
  return report
}
