import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { WorkflowSecretInventory, WorkflowSecretInventoryEntry } from './types.mts'

export const DEFAULT_INVENTORY_PATH = '.github/workflows/workflow-secrets-inventory.mts'
export const DEFAULT_INVENTORY_EXPORT = 'SECRET_INVENTORY'

const OPTIONAL_FIELDS = [
  ['neverProvision', 'boolean'],
  ['requiredEnvironment', 'string'],
  ['requiredBranchPolicy', 'string'],
] as const

function entryProblem(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return 'must be an object'
  return recordProblem(entry as Record<string, unknown>)
}

function recordProblem(record: Record<string, unknown>): string | undefined {
  if (typeof record.provisioned !== 'boolean') return 'must have a boolean provisioned'
  for (const [field, type] of OPTIONAL_FIELDS) {
    if (record[field] !== undefined && typeof record[field] !== type) {
      return `${field} must be a ${type}`
    }
  }
  if (record.neverProvision && record.provisioned) {
    return 'neverProvision cannot be combined with provisioned: true'
  }
  if (record.neverProvision && (record.requiredEnvironment ?? record.requiredBranchPolicy)) {
    return 'neverProvision cannot be combined with a required scope'
  }
  if (record.requiredEnvironment !== undefined && record.requiredBranchPolicy !== undefined) {
    return 'requiredEnvironment and requiredBranchPolicy are mutually exclusive'
  }
  return undefined
}

/**
 * GitHub stores secret names upper-case and treats environment names case-insensitively, so
 * names are compared as upper-case secrets and lower-case environments.
 */
export function normalizeInventory(inventory: WorkflowSecretInventory): WorkflowSecretInventory {
  const normalized: Record<string, WorkflowSecretInventoryEntry> = {}
  for (const [name, entry] of Object.entries(inventory)) {
    const { requiredEnvironment, requiredBranchPolicy } = entry
    if (Object.hasOwn(normalized, name.toUpperCase())) {
      throw new Error(`inventory names collide after normalization: ${name}`)
    }
    normalized[name.toUpperCase()] = {
      ...entry,
      ...(requiredEnvironment === undefined
        ? {}
        : { requiredEnvironment: requiredEnvironment.toLowerCase() }),
      ...(requiredBranchPolicy === undefined
        ? {}
        : { requiredBranchPolicy: requiredBranchPolicy.toLowerCase() }),
    }
  }
  return normalized
}

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
    const problem = entryProblem(entry)
    if (problem !== undefined) throw new Error(`${modulePath}: ${exportName}.${name} ${problem}`)
  }
  return inventory as WorkflowSecretInventory
}
