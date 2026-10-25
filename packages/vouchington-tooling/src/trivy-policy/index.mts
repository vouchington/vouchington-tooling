import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  assertUnfilteredComponentSbom,
  assertVulnerabilityGate,
  isComponentSbomGeneration,
  isDownloadDatabaseOnly,
} from './gate.mts'
import { resolveOptions, type TrivyPolicyOptions } from './options.mts'
import { parseIgnoreRegistry, validateIgnoreRegistry } from './registry.mts'
import { trivyPackageScanCommands } from './scan.mts'

export { assertUnfilteredComponentSbom, assertVulnerabilityGate, isComponentSbomGeneration }
export { isDownloadDatabaseOnly }
export {
  isTrivyPackageScanCommand,
  trivyPackageScanCommandSegments,
  trivyPackageScanSubcommand,
} from './invocations.mts'
export type { ResolvedTrivyPolicyOptions, TrivyPolicyOptions } from './options.mts'
export { resolveOptions } from './options.mts'
export { parseIgnoreRegistry, validateIgnoreRegistry } from './registry.mts'
export type { Ignore, IgnoreRegistry } from './registry.mts'
export {
  assertNoUnsupportedTrivyAction,
  assertNoUnsupportedTrivyShellSource,
  isShellPolicySource,
  trivyPackageScanCommands,
} from './scan.mts'

function attempt(violations: string[], check: () => void): void {
  try {
    check()
  } catch (error) {
    violations.push((error as Error).message)
  }
}

/**
 * Validates the Trivy workflow steps and commands, the ignore registry and its shape for the
 * tracked files under `root`. Returns one message per violation; an empty list means compliant.
 */
export function checkTrivyPolicy(
  root: string,
  trackedFiles: readonly string[],
  input: TrivyPolicyOptions = {},
): string[] {
  const options = resolveOptions(input)
  const violations: string[] = []
  let commands: string[] = []
  attempt(violations, () => {
    commands = trivyPackageScanCommands(trackedFiles, root)
  })
  if (violations.length > 0) return violations
  const scans = commands.filter((command) => !isDownloadDatabaseOnly(command))
  const sboms = scans.filter(isComponentSbomGeneration)
  const gates = scans.filter((command) => !isComponentSbomGeneration(command))
  if (gates.length < options.minGates || sboms.length < options.minSboms)
    violations.push('Trivy policy requires OS gates and unfiltered component SBOMs')
  for (const command of gates) attempt(violations, () => assertVulnerabilityGate(command, input))
  for (const command of sboms) attempt(violations, () => assertUnfilteredComponentSbom(command))
  if (!trackedFiles.includes(options.ignoreFile))
    violations.push('Trivy exception registry must be tracked')
  else
    attempt(violations, () =>
      validateIgnoreRegistry(
        parseIgnoreRegistry(readFileSync(join(root, options.ignoreFile), 'utf8')),
        input,
      ),
    )
  return violations
}
