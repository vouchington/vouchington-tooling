import {
  matchLocalEnvWrapperCallNames,
  matchWorkflowEnvMapNames,
} from './env-expression-readers.mts'
import { namesAlreadySeen } from './env-reference-matchers.mts'
import { addEnvVar } from './env-var-accumulator.mts'
import { matchNames } from './shared.mts'
import type { EnvVarAccumulator, EnvVarReferenceMatcher, ConfigSourceRules } from './types.mts'

export { seedTypedEnvContractEntries, toEnvVarRow } from './env-var-accumulator.mts'

const PROCESS_ENV_PATTERNS = [
  /\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g,
  /\bprocess\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  /\b(?:const|let|var)\s*\{\s*([^}]+?)\s*\}\s*=\s*process\.env\b/g,
]
const WORKER_ENV_BINDING_PATTERN = /\benv\.([A-Z][A-Z0-9_]*)\b/g
const PROCESS_ENV_IDENTIFIER_PATTERN = /\bprocess\.env\[([A-Z0-9_]+)\]/g
const ENV_ASSIGNMENT_PATTERN = /(?:^|[\s"'(])([A-Z][A-Z0-9_]*)=/g
const EXPORT_ENV_PATTERN = /(?:^|\n)\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=/g
const DEV_INITIALIZE_EXPORT_PATTERN =
  /(?:^|\n)\s*(?:export\s+|printf\s+'export\s+)([A-Z][A-Z0-9_]*)=/g
const DOCKER_ARG_NAME_PATTERN = /(?:^|\n)\s*ARG\s+([A-Z][A-Z0-9_]*)(?:[=\s]|$)/g
const DOCKER_ENV_NAME_PATTERN = /(?:^|\n)\s*ENV\s+([A-Z][A-Z0-9_]*)(?:[=\s]|$)/g
const WRANGLER_JSONC_ENV_NAME_PATTERN = /"([A-Z][A-Z0-9_]*)"\s*:/g
const MARKDOWN_CODE_ENV_PATTERN = /`([A-Z][A-Z0-9_]{2,})`/g

export function collectEnvVarsFromFile(
  file: string,
  source: string,
  envVars: Map<string, EnvVarAccumulator>,
  envConstants: ReadonlyMap<string, string>,
  rules: ConfigSourceRules,
  helperNames: readonly string[],
): void {
  const isMarkdown = rules.markdown === true
  if (!isMarkdown) {
    for (const pattern of PROCESS_ENV_PATTERNS) {
      for (const name of matchEnvNames(source, pattern)) addEnvVar(envVars, name, file, 'readers')
    }
    for (const name of matchConstantIndexedEnvNames(source, envConstants))
      addEnvVar(envVars, name, file, 'readers')
    for (const name of matchHelperNames(source, helperNames))
      addEnvVar(envVars, name, file, 'readers')
    for (const name of matchLocalEnvWrapperCallNames(source, envConstants))
      addEnvVar(envVars, name, file, 'readers')
    if (rules.workerBindings) {
      for (const name of matchEnvNames(source, WORKER_ENV_BINDING_PATTERN))
        addEnvVar(envVars, name, file, 'readers')
    }
  }
  if (rules.localAssignments) {
    for (const name of matchEnvNames(source, EXPORT_ENV_PATTERN)) {
      addEnvVar(envVars, name, file, 'localSetup')
    }
  }
  if (rules.shellExports) {
    for (const name of matchEnvNames(source, DEV_INITIALIZE_EXPORT_PATTERN)) {
      addEnvVar(envVars, name, file, 'localSetup')
    }
  }
  if (rules.jsonBindings) {
    for (const name of matchEnvNames(source, WRANGLER_JSONC_ENV_NAME_PATTERN)) {
      addEnvVar(envVars, name, file, 'localSetup')
    }
  }
  if (rules.docker) {
    for (const name of matchEnvNames(source, DOCKER_ARG_NAME_PATTERN)) {
      addEnvVar(envVars, name, file, 'deployment')
      addEnvVar(envVars, name, file, 'dockerBuildArgs')
    }
    for (const name of matchEnvNames(source, DOCKER_ENV_NAME_PATTERN)) {
      addEnvVar(envVars, name, file, 'deployment')
    }
  }
  if (rules.workflow) {
    for (const name of matchWorkflowEnvMapNames(source)) {
      addEnvVar(envVars, name, file, 'workflows')
    }
  }
  if (rules.markdown) {
    for (const name of matchEnvNames(source, MARKDOWN_CODE_ENV_PATTERN))
      addEnvVar(envVars, name, file, 'docs')
  }
  if (rules.packageManifest) {
    for (const name of matchEnvNames(source, ENV_ASSIGNMENT_PATTERN))
      addEnvVar(envVars, name, file, 'packageGates')
  }
}

export function collectEnvVarReferencesFromFile(
  file: string,
  source: string,
  envVars: Map<string, EnvVarAccumulator>,
  referenceMatchers: EnvVarReferenceMatcher[],
  buckets: readonly import('./types.mts').SourceBucket[],
): void {
  for (const bucket of buckets) {
    for (const name of namesAlreadySeen(source, referenceMatchers))
      addEnvVar(envVars, name, file, bucket)
  }
}

function matchEnvNames(source: string, pattern: RegExp): string[] {
  if (pattern === PROCESS_ENV_PATTERNS[2]) {
    return [...source.matchAll(pattern)].flatMap((match) =>
      parseDestructuredEnvNames(match[1] ?? ''),
    )
  }
  return matchNames(source, pattern)
}

function parseDestructuredEnvNames(bindingList: string): string[] {
  return bindingList.split(',').flatMap((binding) => {
    const name = binding.trim().match(/^([A-Z][A-Z0-9_]*)\b/)?.[1]
    return name ? [name] : []
  })
}

function matchConstantIndexedEnvNames(
  source: string,
  envConstants: ReadonlyMap<string, string>,
): string[] {
  return [...source.matchAll(PROCESS_ENV_IDENTIFIER_PATTERN)].flatMap((match) => {
    const name = envConstants.get(match[1]!)
    return name ? [name] : []
  })
}

function matchHelperNames(source: string, names: readonly string[]): string[] {
  if (names.length === 0) return []
  const pattern = new RegExp(
    String.raw`(?<![\w$])(?:${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, (character) => `\\${character}`)).join('|')})\(\s*['"]([A-Z][A-Z0-9_]*)['"]`,
    'g',
  )
  return matchNames(source, pattern)
}
