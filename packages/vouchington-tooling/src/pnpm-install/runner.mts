import { scheduler } from 'node:timers/promises'

import {
  persistentDependencyTreeIsCold,
  persistentMetadataFingerprint,
  persistentMetadataMatches,
  writePersistentMetadataStamp,
} from './metadata.mts'
import { nativeBinariesMatchRuntime } from './native-health.mts'
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

// oxfmt-ignore
const fail = (message: string): never => { throw new Error(message) }

async function install(args: string[], options: InstallOptions, label: string) {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const attemptResult = await runPnpm(args, options)
    if (attemptResult.code === 0) return
    if (attemptResult.code === INSTALL_TERMINATION_FAILED)
      fail(`${label} could not terminate safely`)
    const combinedOutput = `${attemptResult.output}\n${attemptResult.errorOutput ?? ''}`
    if (isReleaseAgeViolation(combinedOutput)) fail(formatReleaseAgeFailure(label, combinedOutput))
    if (attempt < options.maxAttempts) {
      console.warn(`${label} failed (attempt ${attempt}/${options.maxAttempts}); retrying`)
      await scheduler.wait(5000)
    }
  }
  fail(
    `${label} failed after ${options.maxAttempts} attempt${options.maxAttempts === 1 ? '' : 's'}`,
  )
}

function withScriptPolicy(args: string[], installScripts: boolean) {
  return installScripts ? args : [...args, '--ignore-scripts']
}

async function reconcileAndFindMismatches(
  options: InstallOptions,
  runCapture: (args: string[]) => Promise<CommandResult>,
) {
  const forced = ['install', '--frozen-lockfile', '--force', ...baseInstallArgs.slice(2)]
  // oxfmt-ignore
  await install([...forced, '--ignore-scripts', '--ignore-pnpmfile'], options, 'script-free reconciliation')
  // oxfmt-ignore
  await install(withScriptPolicy(forced, options.installScripts), options, 'strict persistent reconciliation')
  return findWorkspaceLinkMismatches(runCapture)
}

async function reconcileOrFail(
  options: InstallOptions,
  runCapture: (args: string[]) => Promise<CommandResult>,
) {
  const remaining = await reconcileAndFindMismatches(options, runCapture)
  if (remaining.length > 0) {
    logWorkspaceLinkMismatches(remaining)
    fail('persistent reconciliation completed with invalid workspace links')
  }
}

async function persistent(options: InstallOptions) {
  if (options.ephemeralWorkspaces.trim())
    fail('ephemeral-workspaces is only valid for ephemeral runners')

  const runCapture = (args: string[]) => runPnpm(args, options, true)
  const fingerprint = await persistentMetadataFingerprint(runCapture, options.installScripts)
  const stamped = await persistentMetadataMatches(fingerprint)
  const nativesMatch = await nativeBinariesMatchRuntime()
  const provenanceOk = stamped && nativesMatch

  // An absent tree has nothing to repair, so one ordinary install below matches the
  // reconciled end state. Check first: an install would otherwise make the tree non-cold.
  const cold = !provenanceOk && (await persistentDependencyTreeIsCold())
  if (!provenanceOk && !cold) {
    console.warn(
      stamped && !nativesMatch
        ? 'persistent optional native binaries do not match this runtime; reconciling'
        : 'persistent dependency metadata provenance is missing or changed; reconciling',
    )
    await reconcileOrFail(options, runCapture)
    await writePersistentMetadataStamp(fingerprint)
    return 'persistent metadata reconciled'
  }
  if (!stamped) console.warn('persistent dependency tree is absent; installing cold')

  await install(
    withScriptPolicy([...baseInstallArgs], options.installScripts),
    options,
    'ordinary persistent install',
  )
  const stale = await findWorkspaceLinkMismatches(runCapture)
  if (stale.length === 0) {
    if (!stamped) await writePersistentMetadataStamp(fingerprint)
    return stamped ? 'persistent ordinary' : 'persistent cold'
  }

  logWorkspaceLinkMismatches(stale)
  await reconcileOrFail(options, runCapture)
  await writePersistentMetadataStamp(fingerprint)
  return 'persistent reconciled'
}

// A path selector's `...` (dependency closure) suffix is silently ignored by pnpm unless the
// path is brace-wrapped, e.g. `{./web}...` — `./web...` installs only `web` itself. Reject the
// unbraced form outright rather than let it resolve to a smaller-than-intended scope.
function isUnbracedPathClosureSelector(selector: string) {
  return /^\.{0,2}\//.test(selector) && selector.endsWith('...') && !selector.startsWith('{')
}

async function ephemeral(options: InstallOptions) {
  const selectors = options.ephemeralWorkspaces
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
  if (selectors.length === 0) fail('ephemeral-workspaces must contain at least one selector')
  if (
    selectors.some(
      (selector) => selector.startsWith('!') || selector.startsWith('-') || /\s/.test(selector),
    )
  )
    fail('ephemeral-workspaces selectors must be positive and not flags')
  if (selectors.some(isUnbracedPathClosureSelector))
    fail(
      'ephemeral-workspaces path selectors must be brace-wrapped, e.g. {./web}... — bare ./web... silently drops its workspace dependencies',
    )

  const args = withScriptPolicy([...baseInstallArgs], options.installScripts)
  for (const selector of selectors) args.push('--filter', selector)
  await install([...args, '--fail-if-no-match'], options, 'ephemeral filtered install')
  return 'ephemeral filtered'
}

async function ephemeralFull(options: InstallOptions) {
  if (options.ephemeralWorkspaces.trim())
    fail('ephemeral-workspaces is only valid for filtered ephemeral runners')
  await install(
    withScriptPolicy([...baseInstallArgs], options.installScripts),
    options,
    'ephemeral full install',
  )
  return 'ephemeral full'
}

export function runInstallLifecycle(options: InstallOptions) {
  if (options.runnerLifecycle === 'persistent') return persistent(options)
  return options.runnerLifecycle === 'ephemeral-full' ? ephemeralFull(options) : ephemeral(options)
}
