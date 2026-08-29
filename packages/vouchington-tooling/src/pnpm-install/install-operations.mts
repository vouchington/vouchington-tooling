import { scheduler } from 'node:timers/promises'

import { runPnpm } from './exec.mts'
import { INSTALL_TERMINATION_FAILED } from './process.mts'
import { formatReleaseAgeFailure, isReleaseAgeViolation } from './release-age.mts'
import {
  baseInstallArgs,
  findWorkspaceLinkMismatches,
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
  const forced = ['install', '--frozen-lockfile', '--force', ...baseInstallArgs.slice(2)]
  await install(
    [...forced, '--ignore-scripts', '--ignore-pnpmfile'],
    options,
    'script-free reconciliation',
  )
  await install(
    withScriptPolicy(forced, options.installScripts),
    options,
    'strict persistent reconciliation',
  )
  const remaining = await findWorkspaceLinkMismatches(runCapture)
  if (remaining.length > 0) {
    logWorkspaceLinkMismatches(remaining)
    fail('persistent reconciliation completed with invalid workspace links')
  }
}
