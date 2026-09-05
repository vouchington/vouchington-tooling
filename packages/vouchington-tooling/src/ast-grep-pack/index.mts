import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type AstGrepPackPaths = {
  readonly rules: string
  readonly config: string
}

export function astGrepPackPaths(): AstGrepPackPaths {
  const rules = fileURLToPath(new URL('../../ast-grep/rules', import.meta.url))
  const config = fileURLToPath(new URL('../../ast-grep/sgconfig.yml', import.meta.url))
  if (!existsSync(rules) || !existsSync(config)) {
    throw new Error('ast-grep pack is missing from the installed package')
  }
  return { rules, config }
}
