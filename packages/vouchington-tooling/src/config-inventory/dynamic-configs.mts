import { sorted } from './shared.mts'
import type { DynamicConfigInventoryRow, DynamicConfigReference } from './types.mts'

export function addDynamicConfigReferences(
  rows: Map<string, DynamicConfigInventoryRow>,
  file: string,
  references: readonly DynamicConfigReference[],
): void {
  for (const { namespace, kind } of references) {
    const row = rows.get(namespace) ?? { namespace, definitionFiles: [], registryFiles: [] }
    const key = kind === 'definition' ? 'definitionFiles' : 'registryFiles'
    row[key] = sorted(new Set([...row[key], file]))
    rows.set(namespace, row)
  }
}
