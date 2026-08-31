import { scheduler } from 'node:timers/promises'

import { runPnpm } from './exec.mts'
import { nativeBinariesMatchRuntime, repairedNativeBinariesMatchRuntime } from './native-health.mts'
import { buildLedgersAllowNativeRepair } from './pending-builds.mts'
import { INSTALL_TERMINATION_FAILED } from './process.mts'
import { formatReleaseAgeFailure, isReleaseAgeViolation } from './release-age.mts'
import {
  findWorkspaceLinkMismatches,
  forcedInstallArgs,
  logWorkspaceLinkMismatches,
  type CommandResult,
  type InstallOptions,
} from './support.mts'

function fail(message: string): never {
  throw new Error(message)
}

export function withScriptPolicy(args: string[], installScripts: boolean) {
  return installScripts ? args : [...args, '--ignore-scripts']
}

export async function install(args: string[], options: InstallOptions, label: string) {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const result = await runPnpm(args, options)
    if (result.code === 0) return
    if (result.code === INSTALL_TERMINATION_FAILED) fail(`${label} could not terminate safely`)
    const output = `${result.output}\n${result.errorOutput ?? ''}`
    if (isReleaseAgeViolation(output)) fail(formatReleaseAgeFailure(label, output))
    if (attempt < options.maxAttempts) {
      console.warn(`${label} failed (attempt ${attempt}/${options.maxAttempts}); retrying`)
      await scheduler.wait(5000)
    }
  }
  fail(
    `${label} failed after ${options.maxAttempts} attempt${options.maxAttempts === 1 ? '' : 's'}`,
  )
}

export async function reconcileOrFail(
  options: InstallOptions,
  runCapture: (args: string[]) => Promise<CommandResult>,
) {
  await install(
    [...forcedInstallArgs, '--ignore-scripts', '--ignore-pnpmfile'],
    options,
    'script-free reconciliation',
  )
  await install(
    withScriptPolicy(forcedInstallArgs, options.installScripts),
    options,
    'strict persistent reconciliation',
  )
  await verifyInstallHealth(runCapture, 'persistent reconciliation')
}

async function verifyInstallHealth(
  runCapture: (args: string[]) => Promise<CommandResult>,
  phase: string,
  repairedNativePaths: string[] = [],
) {
  const [nativesMatch, remaining] = await Promise.all([
    repairedNativePaths.length > 0
      ? repairedNativeBinariesMatchRuntime(repairedNativePaths)
      : nativeBinariesMatchRuntime(),
    findWorkspaceLinkMismatches(runCapture),
  ])
  if (!nativesMatch) fail(`${phase} completed with mismatched native binaries`)
  if (remaining.length > 0) {
    logWorkspaceLinkMismatches(remaining)
    fail(`${phase} completed with invalid workspace links`)
  }
}

export async function repairIsolatedNativeMismatch(
  options: InstallOptions,
  runCapture: (args: string[]) => Promise<CommandResult>,
  mismatchedNativePaths: string[],
) {
  if (!(await buildLedgersAllowNativeRepair())) return false
  if ((await findWorkspaceLinkMismatches(runCapture)).length > 0) return false
  await install(
    withScriptPolicy(forcedInstallArgs, options.installScripts),
    options,
    'native health reconciliation',
  )
  await verifyInstallHealth(runCapture, 'native health reconciliation', mismatchedNativePaths)
  return true
}
