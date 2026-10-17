/**
 * The environment to spawn `gh` with: `env` minus `CLICOLOR_FORCE`. A non-zero `CLICOLOR_FORCE`
 * makes `gh ... --json` emit ANSI-colored JSON even on a pipe, and `NO_COLOR` does not override
 * it, so callers that `JSON.parse` gh output would throw. Deleting the key (rather than setting
 * it to `0`) restores gh's default and never adds a variable the caller did not have. Every other
 * variable passes through untouched; the input is not mutated. Windows environment variable names
 * are case-insensitive, so the key is matched case-insensitively there.
 */
export function ghSpawnEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const isForcedColor = (key: string): boolean =>
    platform === 'win32' ? key.toUpperCase() === 'CLICOLOR_FORCE' : key === 'CLICOLOR_FORCE'
  return Object.fromEntries(Object.entries(env).filter(([key]) => !isForcedColor(key)))
}
