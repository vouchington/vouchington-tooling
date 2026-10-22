import type { WorkflowSecretInventory } from './types.mts'

export interface SecretDrift {
  /** `provisioned: false` in the inventory, but live: flip the flag to true. */
  readonly newlyProvisioned: string[]
  /** `provisioned: true` in the inventory, but not live: investigate. */
  readonly notActuallyProvisioned: string[]
  /** `neverProvision: true` in the inventory, but live anyway: delete the live secret. */
  readonly accidentallyProvisioned: string[]
  /** Live secret with no inventory entry: informational, not a drift failure. */
  readonly unreferenced: string[]
  /** Reads the secret store could not complete (permissions, deleted mid-run, etc). */
  readonly warnings: string[]
}

export function diffAgainstInventory(
  inventory: WorkflowSecretInventory,
  liveNames: ReadonlySet<string>,
  warnings: readonly string[],
): SecretDrift {
  const newlyProvisioned: string[] = []
  const notActuallyProvisioned: string[] = []
  const accidentallyProvisioned: string[] = []
  for (const [name, entry] of Object.entries(inventory)) {
    if (entry.neverProvision) {
      if (liveNames.has(name)) accidentallyProvisioned.push(name)
    } else if (!entry.provisioned && liveNames.has(name)) newlyProvisioned.push(name)
    else if (entry.provisioned && !liveNames.has(name)) notActuallyProvisioned.push(name)
  }
  return {
    newlyProvisioned: newlyProvisioned.toSorted(),
    notActuallyProvisioned: notActuallyProvisioned.toSorted(),
    accidentallyProvisioned: accidentallyProvisioned.toSorted(),
    unreferenced: [...liveNames].filter((name) => !Object.hasOwn(inventory, name)).toSorted(),
    warnings: [...warnings],
  }
}

/** `confirmNames` entries that are not live: the operator's post-provisioning checklist fell short. */
export function missingConfirmedSecrets(
  confirmNames: readonly string[],
  liveNames: ReadonlySet<string>,
): string[] {
  return confirmNames.filter((name) => !liveNames.has(name))
}

/**
 * `drift.newlyProvisioned` names not covered by `--confirm`. A confirmed name is expected to still
 * be `provisioned: false` until a follow-up edit, so only other newly-provisioned names are drift.
 */
export function unconfirmedNewlyProvisioned(
  drift: SecretDrift,
  confirmNames: readonly string[],
): string[] {
  const confirmed = new Set(confirmNames)
  return drift.newlyProvisioned.filter((name) => !confirmed.has(name))
}

function section(title: string, names: readonly string[]): string[] {
  return names.length === 0 ? [] : [title, ...names.map((name) => `  - ${name}`)]
}

export function formatDrift(drift: SecretDrift): string {
  const lines = [
    ...section(
      'Now provisioned but still marked `provisioned: false` (flip it in the inventory):',
      drift.newlyProvisioned,
    ),
    ...section(
      'Marked `provisioned: true` but not visible to this gh session (deleted, renamed, or a token-scope gap; verify before editing):',
      drift.notActuallyProvisioned,
    ),
    ...section(
      'Marked `neverProvision: true` but provisioned live anyway (delete the live secret, do not flip `provisioned`):',
      drift.accidentallyProvisioned,
    ),
    ...section(
      'Provisioned but not in the inventory (fine if consumed outside workflows, e.g. Dependabot/Codespaces):',
      drift.unreferenced,
    ),
    ...drift.warnings.map((warning) => `Warning: ${warning}`),
  ]
  if (lines.length === 0) lines.push('The inventory matches the live secret store. No drift.')
  return `${lines.join('\n')}\n`
}
