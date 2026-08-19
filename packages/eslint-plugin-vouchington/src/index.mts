import { readFileSync } from 'node:fs'
import { readPackageVersion } from './package-version.mts'

export interface VouchingtonPlugin {
  meta: { name: string; version: string }
  rules: Record<string, unknown>
}

export const PLUGIN_NAME = 'eslint-plugin-vouchington'

export const RULE_ROUTING = [
  'Generic rules belong in eslint-plugin-no-mistakes.',
  'Vouchington convention rules with no product nouns belong here.',
  'Single-repo product coupling stays in the product monorepo.',
] as const

export function createPlugin(version = readInstalledVersion()): VouchingtonPlugin {
  return {
    meta: { name: PLUGIN_NAME, version },
    rules: {},
  }
}

export default createPlugin()

function readInstalledVersion(): string {
  return readPackageVersion(
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
  )
}
