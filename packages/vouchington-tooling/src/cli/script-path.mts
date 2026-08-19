import { fileURLToPath } from 'node:url'

export function packageScriptPath(relativeFromPackageRoot: string): string {
  return fileURLToPath(new URL(`../../${relativeFromPackageRoot}`, import.meta.url))
}
