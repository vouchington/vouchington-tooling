import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false
  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href
  } catch {
    return metaUrl === pathToFileURL(resolve(argv1)).href
  }
}
