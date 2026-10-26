// Text normalization shared by build tags and `docker run` image references, so a shell variable
// and the workflow expression feeding it compare equal. Matching stays exact: nothing here expands
// a value, it only rewrites spellings of the same name.
const EXPRESSION = /\$\{\{\s*([^}]*?)\s*\}\}/gu
const WHOLE_EXPRESSION = /^\$\{\{\s*([^}]*?)\s*\}\}$/u
const SHELL_VARIABLE = /^\$(?:(\w+)|\{(\w+)\})$/u

export type EnvMap = ReadonlyMap<string, string>

/** Maps `${{ expr }}` to `$NAME` for each step `env: NAME: ${{ expr }}` entry. */
export function envMapping(env: unknown): EnvMap {
  const map = new Map<string, string>()
  if (typeof env !== 'object' || env === null) return map
  for (const [name, value] of Object.entries(env)) {
    const expression =
      typeof value === 'string' ? WHOLE_EXPRESSION.exec(value.trim())?.[1] : undefined
    if (expression !== undefined) map.set(expression, `$${name}`)
  }
  return map
}

/**
 * Strips quotes, rewrites `${X}` as `$X`, `${{ env.X }}` as `$X`, and any expression a step `env`
 * mapping assigns to a variable as that variable.
 */
export function normalizeText(text: string, env: EnvMap = new Map()): string {
  return text
    .replace(/["']/gu, '')
    .replace(EXPRESSION, (_, expression: string) => {
      const name = /^env\.(\w+)$/u.exec(expression)?.[1]
      return env.get(expression) ?? (name ? `$${name}` : `\${{ ${expression} }}`)
    })
    .replace(/\$\{(\w+)\}/gu, '$$$1')
}

/** The variable name when an image argument is exactly `$VAR`, `"$VAR"` or `${VAR}`. */
export function variableName(token: string): string | undefined {
  const match = SHELL_VARIABLE.exec(token.replace(/^(["'])(.*)\1$/u, '$2'))
  return match?.[1] ?? match?.[2]
}

/** Value of the last `VAR=value` statement in `before` (the same run block, earlier lines). */
export function lastAssignment(before: string, name: string): string | undefined {
  const pattern = new RegExp(
    `^[ \\t]*(?:(?:export|local|readonly)[ \\t]+)?${name}=("[^"]*"|'[^']*'|[^\\s;&|)]*)`,
    'gmu',
  )
  return [...before.matchAll(pattern)].at(-1)?.[1]
}
