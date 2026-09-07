export type ProvenanceStatus =
  | { kind: 'absent' }
  | { kind: 'changed'; components: string[] }
  | {
      kind: 'matching'
      lastInvocationInstallScripts: boolean
      scriptsEnabledInstallVerified: boolean
    }
  | { kind: 'unsafe' }

export type PersistentInstallTransition = {
  action: 'ordinary' | 'reconcile'
  reason: string
}

// The matching rows are deliberately explicit: a script-disabled invocation can never erase
// evidence that this structural tree has already completed a scripts-enabled install.
export function persistentInstallTransition(
  provenance: ProvenanceStatus,
  installScripts: boolean,
): PersistentInstallTransition {
  if (provenance.kind === 'matching') {
    if (installScripts && !provenance.scriptsEnabledInstallVerified)
      return { action: 'reconcile', reason: 'scripts-enabled-install-unverified' }
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
    scriptsEnabledInstallVerified:
      provenance.kind === 'matching' ? provenance.scriptsEnabledInstallVerified : false,
    lastInvocationInstallScripts:
      provenance.kind === 'matching' ? provenance.lastInvocationInstallScripts : null,
    nativeBinariesMatchRuntime,
    reason: transition.reason,
    state: provenance.kind,
  })
}
