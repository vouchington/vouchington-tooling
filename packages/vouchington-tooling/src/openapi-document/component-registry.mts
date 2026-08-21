import { createHash } from 'node:crypto'

import type { ContractSchemaNode } from './contract-schema-types.mts'
import { nodeToOpenApi } from './contract-schema-to-openapi.mts'
import type { OpenApiSchema } from './openapi-types.mts'

export type ComponentRegistry = {
  refName: (rawName: string) => string
  register: (source: string, definitions: Record<string, ContractSchemaNode>) => void
  schemas: () => Record<string, OpenApiSchema>
}

export function sanitizeComponentName(rawName: string): string {
  return rawName
    .replace(/[<,]/g, '_')
    .replace(/>/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
}

export function createComponentRegistry(): ComponentRegistry {
  const sanitizedNames = new Map<string, string>()
  const entries = new Map<string, { hash: string; source: string; schema: OpenApiSchema }>()

  function refName(rawName: string): string {
    const existing = sanitizedNames.get(rawName)
    if (existing) return existing
    const sanitized = sanitizeComponentName(rawName)
    sanitizedNames.set(rawName, sanitized)
    return sanitized
  }

  function register(source: string, definitions: Record<string, ContractSchemaNode>): void {
    const rawNames = Object.keys(definitions).toSorted((left, right) => left.localeCompare(right))
    const pending = new Map<string, { hash: string; source: string; schema: OpenApiSchema }>()
    for (const rawName of rawNames) {
      const sanitized = refName(rawName)
      const schema = nodeToOpenApi(definitions[rawName]!, { definitions, refName })
      const hash = createHash('sha256').update(JSON.stringify(schema)).digest('hex')
      const existing = entries.get(sanitized) ?? pending.get(sanitized)
      if (existing) {
        if (existing.hash !== hash) {
          throw new Error(
            [
              `OpenAPI component "${sanitized}" (raw name "${rawName}") maps to conflicting shapes.`,
              `Existing source: ${existing.source}`,
              `Conflicting source: ${source}`,
            ].join('\n'),
          )
        }
        continue
      }
      pending.set(sanitized, { hash, source, schema })
    }
    for (const [sanitized, entry] of pending) entries.set(sanitized, entry)
  }

  function schemas(): Record<string, OpenApiSchema> {
    return Object.fromEntries(
      [...entries.entries()]
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([name, entry]) => [name, entry.schema]),
    )
  }

  return { refName, register, schemas }
}
