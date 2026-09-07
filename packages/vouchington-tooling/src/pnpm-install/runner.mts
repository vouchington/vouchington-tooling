import {
  persistentDependencyTreeIsCold,
  persistentMetadataFingerprintV5,
  persistentMetadataStatusV5,
  writePersistentMetadataStampV5,
} from './metadata.mts'
import { runPnpm } from './exec.mts'
import { mismatchedNativeBinaries } from './native-health.mts'
// oxfmt-ignore
import { pendingBuilds, type PendingBuildState } from './pending-builds.mts'
// oxfmt-ignore
import { finalizePendingBuilds, install, reconcileOrFail, repairIsolatedNativeMismatch, withScriptPolicy } from './install-operations.mts'
// oxfmt-ignore
import { baseInstallArgs, findWorkspaceLinkMismatches, logWorkspaceLinkMismatches, type InstallOptions } from './support.mts'
import { persistentInstallTransition, persistentProvenanceDiagnostic } from './transition.mts'
// oxfmt-ignore
const fail = (message: string): never => { throw new Error(message) }
async function persistent(options: InstallOptions) {
  if (options.ephemeralWorkspaces.trim())
    fail('ephemeral-workspaces is only valid for ephemeral runners')
  const runCapture = (args: string[]) => runPnpm(args, options, true)
  const fingerprint = await persistentMetadataFingerprintV5(runCapture)
  const provenance = await persistentMetadataStatusV5(fingerprint)
  const pendingBefore = await pendingBuilds()
  const mismatchedNatives = await mismatchedNativeBinaries()
  const nativesMatch = mismatchedNatives.length === 0
  const repairedNativeMismatch =
    !nativesMatch &&
    provenance.kind === 'matching' &&
    (await repairIsolatedNativeMismatch(options, runCapture, mismatchedNatives))
  if (repairedNativeMismatch) {
    const pendingAfterRepair = await finalizePendingBuilds(
      options,
      runCapture,
      'native health reconciliation',
    )
    console.warn('persistent optional native binaries do not match this runtime; reconciled')
    console.warn(
      persistentProvenanceDiagnostic(provenance, options.installScripts, nativesMatch, {
        action: 'reconcile',
        reason: 'native-health-mismatch',
      }),
    )
    await writePersistentMetadataStampV5(
      fingerprint,
      options.installScripts,
      options.installScripts || persistentStampRemainsVerified(provenance, pendingAfterRepair),
    )
    return 'persistent native health reconciled'
  }
  const provisionalTransition = persistentInstallTransition(provenance, options.installScripts)
  const transition = !nativesMatch
    ? { action: 'reconcile' as const, reason: 'native-health-mismatch' }
    : provenance.kind !== 'matching' || pendingBefore.kind === 'clear'
      ? provisionalTransition
      : { action: 'reconcile' as const, reason: 'pending-build-ledger-unverified' }
  const provenanceOk =
    provenance.kind === 'matching' && transition.action !== 'reconcile' && nativesMatch
  const cold = !provenanceOk && (await persistentDependencyTreeIsCold())
  if (!provenanceOk && !cold) {
    const finalTransition =
      provenance.kind === 'absent'
        ? { action: 'reconcile' as const, reason: 'missing-stamp-populated-tree' }
        : transition
    console.warn(
      persistentProvenanceDiagnostic(
        provenance,
        options.installScripts,
        nativesMatch,
        finalTransition,
      ),
    )
    console.warn(
      provenance.kind === 'matching' && !nativesMatch
        ? 'persistent optional native binaries do not match this runtime; reconciling'
        : 'persistent dependency metadata provenance is missing or changed; reconciling',
    )
    await reconcileOrFail(options)
    const pendingAfterReconcile = await finalizePendingBuilds(
      options,
      runCapture,
      'persistent reconciliation',
    )
    await writePersistentMetadataStampV5(
      fingerprint,
      options.installScripts,
      options.installScripts || persistentStampRemainsVerified(provenance, pendingAfterReconcile),
    )
    return 'persistent metadata reconciled'
  }
  if (provenance.kind === 'absent')
    console.warn('persistent dependency tree is absent; installing cold')
  await install(
    withScriptPolicy([...baseInstallArgs], options.installScripts),
    options,
    'ordinary persistent install',
  )
  const stale = await findWorkspaceLinkMismatches(runCapture)
  if (stale.length === 0) {
    const pendingAfterInstall = await finalizePendingBuilds(
      options,
      runCapture,
      'persistent install',
    )
    console.warn(
      persistentProvenanceDiagnostic(provenance, options.installScripts, nativesMatch, transition),
    )
    await writePersistentMetadataStampV5(
      fingerprint,
      options.installScripts,
      options.installScripts || persistentStampRemainsVerified(provenance, pendingAfterInstall),
    )
    return provenance.kind === 'absent' ? 'persistent cold' : 'persistent ordinary'
  }
  logWorkspaceLinkMismatches(stale)
  console.warn(
    persistentProvenanceDiagnostic(provenance, options.installScripts, nativesMatch, {
      action: 'reconcile',
      reason: 'workspace-links-stale',
    }),
  )
  await reconcileOrFail(options)
  const pendingAfterReconcile = await finalizePendingBuilds(
    options,
    runCapture,
    'persistent reconciliation',
  )
  await writePersistentMetadataStampV5(
    fingerprint,
    options.installScripts,
    options.installScripts || persistentStampRemainsVerified(provenance, pendingAfterReconcile),
  )
  return 'persistent reconciled'
}

function persistentStampRemainsVerified(
  provenance: Awaited<ReturnType<typeof persistentMetadataStatusV5>>,
  pending: PendingBuildState,
) {
  return (
    provenance.kind === 'matching' &&
    provenance.scriptsEnabledInstallVerified &&
    pending.kind === 'clear'
  )
}

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
