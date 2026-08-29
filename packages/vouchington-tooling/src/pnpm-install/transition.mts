export type ProvenanceStatus =
  | { kind: 'absent' }
  | { kind: 'changed'; components: string[] }
  | {
      kind: 'matching'
      lastInvocationInstallScripts: boolean
      scriptsEnabledInstallSucceeded: boolean
    }
  | { kind: 'unsafe' }

export type PersistentInstallTransition = {
  action: 'ordinary' | 'reconcile' | 'upgrade-scripts'
  reason: string
}

// The matching rows are deliberately explicit: a script-disabled invocation can never erase
// evidence that this structural tree has already completed a scripts-enabled install.
export function persistentInstallTransition(
  provenance: ProvenanceStatus,
  installScripts: boolean,
): PersistentInstallTransition {
  if (provenance.kind === 'matching') {
    if (installScripts && !provenance.scriptsEnabledInstallSucceeded)
      return { action: 'upgrade-scripts', reason: 'pending-scripts-rebuild' }
    return { action: 'ordinary', reason: 'matching-structural-provenance' }
  }
  if (provenance.kind === 'absent') return { action: 'ordinary', reason: 'missing-stamp' }
  return {
    action: 'reconcile',
    reason: provenance.kind === 'changed' ? 'structural-provenance-changed' : 'unsafe-stamp',
  }
}

export function persistentProvenanceDiagnostic(
  provenance: ProvenanceStatus,
  installScripts: boolean,
  nativeBinariesMatchRuntime: boolean,
  transition: PersistentInstallTransition,
) {
  return JSON.stringify({
    action: transition.action,
    changedComponents: provenance.kind === 'changed' ? provenance.components : [],
    event: 'pnpm-install-persistent-provenance',
    installScripts,
    scriptsEnabledInstallSucceeded:
      provenance.kind === 'matching' ? provenance.scriptsEnabledInstallSucceeded : false,
    lastInvocationInstallScripts:
      provenance.kind === 'matching' ? provenance.lastInvocationInstallScripts : null,
    nativeBinariesMatchRuntime,
    reason: transition.reason,
    state: provenance.kind,
  })
}
