export type EnvClassification = string

export interface EnvVarInventoryRow {
  name: string
  classifications: EnvClassification[]
  reviewReason: string | null
  contractKey: string | null
  contractKeys: string[]
  sourceOfTruth: string | null
  sensitivity: string | null
  runtimeSurfaces: string[]
  readers: string[]
  localSetup: string[]
  docs: string[]
  deployment: string[]
  dockerBuildArgs: string[]
  workflows: string[]
  packageGates: string[]
}

export interface DynamicConfigInventoryRow {
  namespace: string
  definitionFiles: string[]
  registryFiles: string[]
}

export interface PackageGateInventoryRow {
  name: string
  values: string[]
  files: string[]
}

export interface ConfigInventory {
  envVars: EnvVarInventoryRow[]
  dynamicConfigs: DynamicConfigInventoryRow[]
  packageGates: PackageGateInventoryRow[]
}

export interface EnvVarAccumulator {
  name: string
  contractKey: string | null
  contractKeys: Set<string>
  sourceOfTruth: string | null
  sensitivity: string | null
  runtimeSurfaces: Set<string>
  readers: Set<string>
  localSetup: Set<string>
  docs: Set<string>
  deployment: Set<string>
  dockerBuildArgs: Set<string>
  workflows: Set<string>
  packageGates: Set<string>
}

export type SourceBucket = keyof Omit<
  EnvVarAccumulator,
  'name' | 'contractKey' | 'contractKeys' | 'sourceOfTruth' | 'sensitivity' | 'runtimeSurfaces'
>

export interface EnvVarReferenceMatcher {
  name: string
  pattern: RegExp
}

export interface TypedEnvContractEntry {
  name: string
  contractKey?: string
  sourceOfTruth?: string
  sensitivity?: string
  runtimeSurfaces?: string[]
}

/** Discovery is opt-in by file role; the caller owns paths and exclusions. */
export interface ConfigSourceRules {
  workerBindings?: boolean
  localAssignments?: boolean
  shellExports?: boolean
  jsonBindings?: boolean
  docker?: boolean
  workflow?: boolean
  markdown?: boolean
  packageManifest?: boolean
  packageManagerConfig?: boolean
  referenceBuckets?: readonly SourceBucket[]
}

export interface ConfigInventoryContext {
  trackedFiles: readonly string[]
  /** Return null for a missing/non-text file. Reader failures propagate. */
  readTrackedFile(file: string): string | null
}

export interface DynamicConfigReference {
  namespace: string
  kind: 'definition' | 'registry'
}

export interface ConfigInventoryOptions {
  /** Return null to exclude a file before it is read. */
  describeFile(file: string): ConfigSourceRules | null
  envContract?: readonly TypedEnvContractEntry[]
  envConstants?: ReadonlyMap<string, string>
  envHelperNames?: readonly string[]
  /** Sensitivity labels from least to most sensitive. Defaults to internal, public, secret. */
  sensitivityOrder?: readonly string[]
  collectDynamicConfigs?(file: string, source: string): readonly DynamicConfigReference[]
  annotateEnv?(row: Readonly<EnvVarInventoryRow>): {
    classifications: string[]
    reviewReason: string | null
  }
}
