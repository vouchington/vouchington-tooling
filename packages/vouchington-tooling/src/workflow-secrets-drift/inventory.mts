import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { WorkflowSecretInventory } from './types.mts'

export const DEFAULT_INVENTORY_PATH = '.github/workflows/workflow-secrets-inventory.mts'
export const DEFAULT_INVENTORY_EXPORT = 'SECRET_INVENTORY'

/** Loads the named export of an inventory module (resolved against `cwd`) and checks its shape. */
export async function loadInventory(
  modulePath: string,
  exportName: string,
  cwd: string = process.cwd(),
): Promise<WorkflowSecretInventory> {
  const loaded = (await import(pathToFileURL(resolve(cwd, modulePath)).href)) as Record<
    string,
    unknown
  >
  const inventory = loaded[exportName]
  if (typeof inventory !== 'object' || inventory === null || Array.isArray(inventory)) {
    throw new Error(`${modulePath} must export an object named ${exportName}`)
  }
  for (const [name, entry] of Object.entries(inventory)) {
    if (typeof entry !== 'object' || entry === null || typeof entry.provisioned !== 'boolean') {
      throw new Error(`${modulePath}: ${exportName}.${name} must have a boolean provisioned`)
    }
  }
  return inventory as WorkflowSecretInventory
}
