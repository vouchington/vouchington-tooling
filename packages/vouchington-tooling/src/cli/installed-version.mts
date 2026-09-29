import { readFileSync } from 'node:fs'
import { readPackageVersion } from '../package-version.mts'

export function readInstalledVersion(): string {
  return readPackageVersion(
    JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')),
  )
}
