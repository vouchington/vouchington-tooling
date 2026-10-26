// Text normalization shared by build tags and `docker run` image references, so a shell variable
// and the workflow expression feeding it compare equal. Matching stays exact: nothing here expands
// a value, it only rewrites spellings of the same name.
const EXPRESSION = /\$\{\{\s*([^}]*?)\s*\}\}/gu
const SHELL_VARIABLE = /^\$(?:(\w+)|\{(\w+)\})$/u

export type EnvMap = ReadonlyMap<string, string>

/** Canonical text of each variable a step `env:` mapping defines, keyed by name. */
export function envMapping(env: unknown): EnvMap {
  const map = new Map<string, string>()
  if (typeof env !== 'object' || env === null) return map
  for (const [name, value] of Object.entries(env)) map.set(name, canonical(String(value).trim()))
  return map
}

function canonical(text: string): string {
  return text
    .replace(/["']/gu, '')
    .replace(EXPRESSION, (_, expression: string) => {
      const name = /^env\.(\w+)$/u.exec(expression)?.[1]
      return name ? `$${name}` : `\${{ ${expression} }}`
    })
    .replace(/\$\{(\w+)\}/gu, '$$$1')
}

/**
 * Strips quotes, rewrites `${X}` as `$X` and `${{ env.X }}` as `$X`, then replaces each `$NAME`
 * the step `env:` defines with that value, so a step-local binding is compared by what it holds
 * (an expression or a literal), not by its name.
 */
export function normalizeText(text: string, env: EnvMap = new Map()): string {
  return canonical(text).replace(/\$(\w+)/gu, (match, name: string) => env.get(name) ?? match)
}

/** The variable name when an image argument is exactly `$VAR`, `"$VAR"` or `${VAR}` (not single-quoted). */
export function variableName(token: string): string | undefined {
  const match = SHELL_VARIABLE.exec(token.replace(/^"(.*)"$/u, '$1'))
  return match?.[1] ?? match?.[2]
}

/**
 * Value of the last `VAR=value` statement in `before` (the same run block, earlier lines). Only
 * unindented statements are trusted: any indented assignment to the name may sit in a branch that
 * does not run, so the variable is then left unresolved.
 */
export function lastAssignment(before: string, name: string): string | undefined {
  const pattern = new RegExp(
    `^([ \\t]*)(?:(?:export|local|readonly)[ \\t]+)?${name}=((?:"[^"]*"|'[^']*'|[^\\s;&|)"'])*)`,
    'gmu',
  )
  const found = [...before.matchAll(pattern)]
  return found.some((match) => match[1] !== '') ? undefined : found.at(-1)?.[2]
}
