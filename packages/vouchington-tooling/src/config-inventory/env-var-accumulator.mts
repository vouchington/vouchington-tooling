import { ENV_NAME_PATTERN, sorted } from './shared.mts'
import type {
  EnvVarAccumulator,
  EnvVarInventoryRow,
  SourceBucket,
  TypedEnvContractEntry,
} from './types.mts'

type EnvVarMetadata = Pick<
  TypedEnvContractEntry,
  'contractKey' | 'sourceOfTruth' | 'runtimeSurfaces' | 'sensitivity'
>

const DEFAULT_SENSITIVITY_ORDER = ['internal', 'public', 'secret']

export function seedTypedEnvContractEntries(
  envVars: Map<string, EnvVarAccumulator>,
  entries: readonly TypedEnvContractEntry[],
  sensitivityOrder: readonly string[] = DEFAULT_SENSITIVITY_ORDER,
): void {
  const sensitivityRank = new Map(sensitivityOrder.map((value, index) => [value, index + 1]))
  for (const entry of entries) addTypedEnvContractEntry(envVars, entry, sensitivityRank)
}

export function toEnvVarRow(acc: EnvVarAccumulator): EnvVarInventoryRow {
  const sourceSets = {
    runtimeSurfaces: sorted(acc.runtimeSurfaces),
    contractKeys: sorted(acc.contractKeys),
    readers: sorted(acc.readers),
    localSetup: sorted(acc.localSetup),
    docs: sorted(acc.docs),
    deployment: sorted(acc.deployment),
    dockerBuildArgs: sorted(acc.dockerBuildArgs),
    workflows: sorted(acc.workflows),
    packageGates: sorted(acc.packageGates),
  }
  return {
    name: acc.name,
    classifications: [],
    reviewReason: null,
    contractKey: acc.contractKey,
    sourceOfTruth: acc.sourceOfTruth,
    sensitivity: acc.sensitivity,
    ...sourceSets,
  }
}

export function addEnvVar(
  envVars: Map<string, EnvVarAccumulator>,
  name: string,
  file: string,
  bucket: SourceBucket,
  metadata: EnvVarMetadata = {},
): void {
  if (!ENV_NAME_PATTERN.test(name)) return
  const acc = envVars.get(name) ?? createEnvVarAccumulator(name)
  acc[bucket].add(file)
  mergeEnvVarMetadata(acc, metadata)
  envVars.set(name, acc)
}

function addTypedEnvContractEntry(
  envVars: Map<string, EnvVarAccumulator>,
  entry: TypedEnvContractEntry,
  sensitivityRank: ReadonlyMap<string, number>,
): void {
  if (!ENV_NAME_PATTERN.test(entry.name)) return
  const acc = envVars.get(entry.name) ?? createEnvVarAccumulator(entry.name)
  mergeEnvVarMetadata(acc, entry, sensitivityRank)
  envVars.set(entry.name, acc)
}

function createEnvVarAccumulator(name: string): EnvVarAccumulator {
  return {
    name,
    contractKey: null,
    contractKeys: new Set<string>(),
    sourceOfTruth: null,
    sensitivity: null,
    runtimeSurfaces: new Set<string>(),
    readers: new Set<string>(),
    localSetup: new Set<string>(),
    docs: new Set<string>(),
    deployment: new Set<string>(),
    dockerBuildArgs: new Set<string>(),
    workflows: new Set<string>(),
    packageGates: new Set<string>(),
  }
}

function mergeEnvVarMetadata(
  acc: EnvVarAccumulator,
  metadata: EnvVarMetadata,
  sensitivityRank: ReadonlyMap<string, number> = new Map(),
): void {
  if (metadata.contractKey) {
    acc.contractKeys.add(metadata.contractKey)
    if (acc.contractKey === null) acc.contractKey = metadata.contractKey
  }
  if (acc.sourceOfTruth === null && metadata.sourceOfTruth)
    acc.sourceOfTruth = metadata.sourceOfTruth
  acc.sensitivity = highestSensitivity(acc.sensitivity, metadata.sensitivity, sensitivityRank)
  for (const surface of metadata.runtimeSurfaces ?? []) acc.runtimeSurfaces.add(surface)
}

function highestSensitivity(
  current: string | null,
  incoming: string | undefined,
  sensitivityRank: ReadonlyMap<string, number>,
): string | null {
  if (!incoming) return current
  if (current === null) return incoming
  return (sensitivityRank.get(incoming) ?? 0) > (sensitivityRank.get(current) ?? 0)
    ? incoming
    : current
}
