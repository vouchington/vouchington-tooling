import {
  persistentDependencyTreeIsCold,
  persistentMetadataFingerprintV4,
  persistentMetadataStatusV4,
  writePersistentMetadataStampV4,
} from './metadata.mts'
import { runPnpm } from './exec.mts'
import { nativeBinariesMatchRuntime } from './native-health.mts'
import {
  clearPendingDependencyBuilds,
  pendingBuildDelta,
  pendingBuilds,
  validDependencyBuildIds,
} from './pending-builds.mts'
import { install, reconcileOrFail, withScriptPolicy } from './install-operations.mts'
import {
  baseInstallArgs,
  findWorkspaceLinkMismatches,
  logWorkspaceLinkMismatches,
  type InstallOptions,
} from './support.mts'
import { persistentInstallTransition, persistentProvenanceDiagnostic } from './transition.mts'

// oxfmt-ignore
const fail = (message: string): never => { throw new Error(message) }

async function persistent(options: InstallOptions) {
  if (options.ephemeralWorkspaces.trim())
    fail('ephemeral-workspaces is only valid for ephemeral runners')

  const runCapture = (args: string[]) => runPnpm(args, options, true)
  const fingerprint = await persistentMetadataFingerprintV4(runCapture)
  const provenance = await persistentMetadataStatusV4(fingerprint)
  const nativesMatch = await nativeBinariesMatchRuntime()
  const provisionalTransition = persistentInstallTransition(provenance, options.installScripts)
  let transition = nativesMatch
    ? provisionalTransition
    : { action: 'reconcile' as const, reason: 'native-health-mismatch' }
  if (transition.action === 'upgrade-dependencies') {
    const ids = await validDependencyBuildIds(transition.pendingDependencyBuilds)
    if (!ids)
      transition = { action: 'upgrade-scripts', reason: 'invalid-pending-dependency-builds' }
    else transition = { ...transition, pendingDependencyBuilds: ids }
  }
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
    await reconcileOrFail(options, runCapture)
    await writePersistentMetadataStampV4(fingerprint, options.installScripts, true, [])
    return 'persistent metadata reconciled'
  }
  if (provenance.kind === 'absent')
    console.warn('persistent dependency tree is absent; installing cold')
  const pendingBefore =
    transition.action === 'ordinary' && !options.installScripts ? await pendingBuilds() : undefined
  await install(
    withScriptPolicy(
      [...baseInstallArgs],
      transition.action.startsWith('upgrade-') ? false : options.installScripts,
    ),
    options,
    'ordinary persistent install',
  )
  const stale = await findWorkspaceLinkMismatches(runCapture)
  if (stale.length === 0) {
    if (transition.action.startsWith('upgrade-')) {
      const pendingDependencyBuilds =
        transition.action === 'upgrade-dependencies'
          ? transition.pendingDependencyBuilds
          : undefined
      const rebuild =
        pendingDependencyBuilds === undefined
          ? ['rebuild', '--pending', '--recursive']
          : ['rebuild', '--recursive', '--', ...pendingDependencyBuilds]
      await install(rebuild, options, 'pending scripts rebuild')
      const rebuiltStale = await findWorkspaceLinkMismatches(runCapture)
      if (rebuiltStale.length > 0) {
        logWorkspaceLinkMismatches(rebuiltStale)
        await reconcileOrFail(options, runCapture)
        console.warn(
          persistentProvenanceDiagnostic(provenance, options.installScripts, nativesMatch, {
            action: 'reconcile',
            reason: 'workspace-links-stale-after-rebuild',
          }),
        )
        await writePersistentMetadataStampV4(fingerprint, options.installScripts, true, [])
        return 'persistent reconciled'
      }
      if (
        pendingDependencyBuilds !== undefined &&
        !(await clearPendingDependencyBuilds(pendingDependencyBuilds))
      )
        fail('dependency rebuild completed but pending build ledger could not be updated safely')
    }
    console.warn(
      persistentProvenanceDiagnostic(provenance, options.installScripts, nativesMatch, transition),
    )
    const pendingAfter = pendingBefore ? await pendingBuilds() : undefined
    const delta =
      pendingBefore && pendingAfter
        ? await pendingBuildDelta(pendingBefore, pendingAfter)
        : undefined
    const unsafePending = delta?.kind === 'unknown' || Boolean(delta?.workspaceIds.length)
    const pendingDependencyBuilds =
      transition.action.startsWith('upgrade-') || unsafePending
        ? []
        : [
            ...new Set([
              ...(provenance.kind === 'matching' ? provenance.pendingDependencyBuilds : []),
              ...(delta?.kind === 'known' ? delta.dependencyIds : []),
            ]),
          ].toSorted()
    await writePersistentMetadataStampV4(
      fingerprint,
      options.installScripts,
      unsafePending,
      pendingDependencyBuilds,
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
  await reconcileOrFail(options, runCapture)
  await writePersistentMetadataStampV4(fingerprint, options.installScripts, true, [])
  return 'persistent reconciled'
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
