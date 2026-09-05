import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type AstGrepPackPaths = {
  readonly rules: string
  readonly config: string
}

export function astGrepPackPathsFrom(rules: string, config: string): AstGrepPackPaths {
  if (!existsSync(rules) || !existsSync(config)) {
    throw new Error('ast-grep pack is missing from the installed package')
  }
  return { rules, config }
}

export function astGrepPackPaths(): AstGrepPackPaths {
  return astGrepPackPathsFrom(
    fileURLToPath(new URL('../../ast-grep/rules', import.meta.url)),
    fileURLToPath(new URL('../../ast-grep/sgconfig.yml', import.meta.url)),
  )
}
