import { matchLocalEnvWrapperCallPrefixes } from './env-expression-readers.mts'
import { ENV_NAME_PATTERN, sorted } from './shared.mts'
import type { EnvVarAccumulator } from './types.mts'

export function collectEnvVarPrefixReadersFromFile(
  file: string,
  source: string,
  envVars: Map<string, EnvVarAccumulator>,
  envConstants: ReadonlyMap<string, string>,
): void {
  const prefixes = matchLocalEnvWrapperCallPrefixes(source, envConstants)
  if (prefixes.length === 0) return
  for (const prefix of prefixes) {
    for (const name of sorted(envVars.keys())) {
      if (name.startsWith(prefix) && ENV_NAME_PATTERN.test(name)) {
        envVars.get(name)?.readers.add(file)
      }
    }
  }
}
