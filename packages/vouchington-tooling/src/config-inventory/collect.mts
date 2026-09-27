import { addDynamicConfigReferences } from './dynamic-configs.mts'
import { collectEnvVarPrefixReadersFromFile } from './env-prefix-readers.mts'
import { compileEnvVarReferenceMatchers } from './env-reference-matchers.mts'
import {
  collectEnvVarReferencesFromFile,
  collectEnvVarsFromFile,
  seedTypedEnvContractEntries,
  toEnvVarRow,
} from './env-vars.mts'
import { collectPackageGatesFromFile } from './package-gates.mts'
import type {
  ConfigInventory,
  ConfigInventoryContext,
  ConfigInventoryOptions,
  ConfigSourceRules,
  DynamicConfigInventoryRow,
  EnvVarAccumulator,
  PackageGateInventoryRow,
} from './types.mts'

/** Collects syntax-level evidence without executing any consumer module. */
export function collectConfigInventory(
  context: ConfigInventoryContext,
  options: ConfigInventoryOptions,
): ConfigInventory {
  const envVars = new Map<string, EnvVarAccumulator>()
  const dynamicConfigs = new Map<string, DynamicConfigInventoryRow>()
  const packageGates = new Map<string, PackageGateInventoryRow>()
  const sources: Array<{ file: string; source: string; rules: ConfigSourceRules }> = []
  const constants = options.envConstants ?? new Map<string, string>()
  seedTypedEnvContractEntries(envVars, options.envContract ?? [], options.sensitivityOrder)

  for (const file of [...new Set(context.trackedFiles)].sort()) {
    const rules = options.describeFile(file)
    if (!rules) continue
    const source = context.readTrackedFile(file)
    if (source === null) continue
    sources.push({ file, source, rules })
    collectEnvVarsFromFile(file, source, envVars, constants, rules, options.envHelperNames ?? [])
    if (rules.packageManagerConfig) collectPackageGatesFromFile(file, source, packageGates)
    addDynamicConfigReferences(
      dynamicConfigs,
      file,
      options.collectDynamicConfigs?.(file, source) ?? [],
    )
  }

  const matchers = compileEnvVarReferenceMatchers(envVars)
  for (const { file, source, rules } of sources) {
    if (!rules.markdown) collectEnvVarPrefixReadersFromFile(file, source, envVars, constants)
    collectEnvVarReferencesFromFile(file, source, envVars, matchers, rules.referenceBuckets ?? [])
  }
  return {
    envVars: [...envVars.values()]
      .map((accumulator) => {
        const row = toEnvVarRow(accumulator)
        return { ...row, ...options.annotateEnv?.(row) }
      })
      .toSorted((a, b) => a.name.localeCompare(b.name)),
    dynamicConfigs: [...dynamicConfigs.values()].toSorted((a, b) =>
      a.namespace.localeCompare(b.namespace),
    ),
    packageGates: [...packageGates.values()].toSorted((a, b) => a.name.localeCompare(b.name)),
  }
}
