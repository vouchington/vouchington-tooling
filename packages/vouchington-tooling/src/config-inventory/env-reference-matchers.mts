import type { EnvVarAccumulator, EnvVarReferenceMatcher } from './types.mts'

export function compileEnvVarReferenceMatchers(
  envVars: Map<string, EnvVarAccumulator>,
): EnvVarReferenceMatcher[] {
  return [...envVars.keys()].map((name) => ({
    name,
    pattern: new RegExp(`(?<![A-Za-z0-9_/-])${name}(?![A-Za-z0-9_/-])`),
  }))
}

export function namesAlreadySeen(
  source: string,
  referenceMatchers: EnvVarReferenceMatcher[],
): string[] {
  return referenceMatchers.flatMap(({ name, pattern }) => (pattern.test(source) ? [name] : []))
}
