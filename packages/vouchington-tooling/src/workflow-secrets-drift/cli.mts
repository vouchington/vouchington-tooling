import { parseArgs } from 'node:util'

import { collectLiveSecretNames } from './collect.mts'
import {
  diffAgainstInventory,
  formatDrift,
  missingConfirmedSecrets,
  unconfirmedNewlyProvisioned,
} from './drift.mts'
import { createGhDependencies } from './gh.mts'
import {
  DEFAULT_INVENTORY_EXPORT,
  DEFAULT_INVENTORY_PATH,
  loadInventory,
  normalizeInventory,
} from './inventory.mts'
import { requiredEnvironmentNames, requiredSecretScopeViolations } from './scopes.mts'
import { errorMessage } from './settle.mts'
import type { WorkflowSecretInventory, WorkflowSecretsDependencies } from './types.mts'

export const USAGE =
  'Usage: vouchington verify-workflow-secrets [--repo <owner/repo>] [--confirm <name1,name2,...>] ' +
  '[--inventory <module>] [--export <name>] [--branch <name>]'

export interface VerifyWorkflowSecretsOptions {
  dependencies?: WorkflowSecretsDependencies
  output?: Pick<Console, 'error' | 'log'>
  /** Skips loading `--inventory` when supplied. */
  inventory?: WorkflowSecretInventory
  cwd?: string
}

const splitNames = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((name) => name.trim().toUpperCase())
    .filter((name) => name.length > 0)

export async function runVerifyWorkflowSecretsCli(
  argv: readonly string[],
  options: VerifyWorkflowSecretsOptions = {},
): Promise<number> {
  const { output = console, dependencies = createGhDependencies() } = options
  let values
  try {
    ;({ values } = parseArgs({
      args: [...argv],
      options: {
        repo: { type: 'string' },
        confirm: { type: 'string' },
        inventory: { type: 'string', default: DEFAULT_INVENTORY_PATH },
        export: { type: 'string', default: DEFAULT_INVENTORY_EXPORT },
        branch: { type: 'string', default: 'main' },
      },
      strict: true,
    }))
  } catch (err) {
    output.error(`${USAGE}\n${errorMessage(err)}`)
    return 2
  }
  const confirmNames = splitNames(values.confirm)
  const emptyOption = (['repo', 'inventory', 'export', 'branch'] as const).find(
    (key) => values[key] !== undefined && values[key].trim() === '',
  )
  if (emptyOption !== undefined || (values.confirm !== undefined && confirmNames.length === 0)) {
    output.error(`${USAGE}\n--${emptyOption ?? 'confirm'} requires a non-empty value`)
    return 2
  }

  try {
    const inventory = normalizeInventory(
      options.inventory ??
        (await loadInventory(values.inventory, values.export, options.cwd ?? process.cwd())),
    )
    const repo = values.repo ?? (await dependencies.resolveRepo())
    const live = await collectLiveSecretNames(
      repo,
      dependencies,
      requiredEnvironmentNames(inventory),
    )
    const drift = diffAgainstInventory(inventory, live.names, live.warnings)
    output.log(formatDrift(drift))
    const scopeViolations = requiredSecretScopeViolations(inventory, {
      ...live,
      deploymentBranch: values.branch,
    })
    if (scopeViolations.length > 0) {
      output.log(
        `Secret scope violations:\n${scopeViolations.map((value) => `  - ${value}`).join('\n')}`,
      )
    }
    const missingConfirmed = missingConfirmedSecrets(confirmNames, live.names)
    if (confirmNames.length > 0) {
      output.log(
        missingConfirmed.length > 0
          ? `--confirm expected these secret(s) to be live, but gh does not see them: ${missingConfirmed.join(', ')}`
          : `Confirmed all ${confirmNames.length} --confirm secret(s) are live.`,
      )
    }
    const failed =
      unconfirmedNewlyProvisioned(drift, confirmNames).length > 0 ||
      drift.notActuallyProvisioned.length > 0 ||
      drift.accidentallyProvisioned.length > 0 ||
      drift.warnings.length > 0 ||
      scopeViolations.length > 0 ||
      missingConfirmed.length > 0
    return failed ? 1 : 0
  } catch (err) {
    output.error(`verify-workflow-secrets failed: ${errorMessage(err)}`)
    return 1
  }
}
