import { createHash } from 'node:crypto'

export type FixtureSchemaLockSource = {
  kind: 'generated'
  generator: string
  caseRoot: string
}

export type FixtureSchemaLock = {
  version: 2
  source: FixtureSchemaLockSource
  schemas: Record<string, { hash: string; fixtureIds: string[] }>
  backendResponseContracts: Record<string, { hash: string; fixtureIds: string[] }>
}

export type FixtureSchemaLockCase = {
  id: string
  responseSchemaKey?: string
  body: unknown
  backendResponseContractKey: string
}

export function responseSchemaFor(
  id: string,
  key: string | undefined,
  body: unknown,
  discriminatorKeys: ReadonlySet<string>,
) {
  return {
    key: key ?? id,
    hash: createHash('sha256')
      .update(stableSchemaStringify(schemaShape(body, discriminatorKeys)))
      .digest('hex'),
  }
}

export function buildFixtureSchemaLock({
  cases,
  backendContracts,
  discriminatorKeys,
  source,
}: {
  cases: readonly FixtureSchemaLockCase[]
  backendContracts: Record<string, { hash: string }>
  discriminatorKeys: ReadonlySet<string>
  source: FixtureSchemaLockSource
}): FixtureSchemaLock {
  const schemas = new Map<string, { hash: string; fixtureIds: string[] }>()
  const casesById = new Map(cases.map((fixtureCase) => [fixtureCase.id, fixtureCase]))
  const fixtureIdsByBackendContract = new Map<string, string[]>()

  for (const fixtureCase of cases) {
    const backendFixtureIds = fixtureIdsByBackendContract.get(
      fixtureCase.backendResponseContractKey,
    )
    if (backendFixtureIds) backendFixtureIds.push(fixtureCase.id)
    else fixtureIdsByBackendContract.set(fixtureCase.backendResponseContractKey, [fixtureCase.id])
    const schema = responseSchemaFor(
      fixtureCase.id,
      fixtureCase.responseSchemaKey,
      fixtureCase.body,
      discriminatorKeys,
    )
    const existing = schemas.get(schema.key)
    if (existing) {
      if (existing.hash !== schema.hash) {
        const existingCase = casesById.get(existing.fixtureIds[0]!)
        throw new Error(
          [
            `Fixture response schema key "${schema.key}" maps to multiple shapes.`,
            `Existing fixtures: ${existing.fixtureIds.join(', ')}`,
            `Mismatched fixture: ${fixtureCase.id}`,
            'Existing shape:',
            stableSchemaStringify(schemaShape(existingCase!.body, discriminatorKeys)),
            'Mismatched shape:',
            stableSchemaStringify(schemaShape(fixtureCase.body, discriminatorKeys)),
          ].join('\n'),
        )
      }
      existing.fixtureIds.push(fixtureCase.id)
      continue
    }

    schemas.set(schema.key, { hash: schema.hash, fixtureIds: [fixtureCase.id] })
  }

  return {
    version: 2,
    source,
    schemas: Object.fromEntries(
      [...schemas.entries()].map(([key, schema]) => [
        key,
        { ...schema, fixtureIds: schema.fixtureIds.toSorted() },
      ]),
    ),
    backendResponseContracts: Object.fromEntries(
      Object.entries(backendContracts).map(([key, contract]) => [
        key,
        {
          hash: contract.hash,
          fixtureIds: (fixtureIdsByBackendContract.get(key) ?? []).toSorted(),
        },
      ]),
    ),
  }
}

function schemaShape(
  value: unknown,
  discriminatorKeys: ReadonlySet<string>,
  propertyKey?: string,
): unknown {
  if (hasToJSON(value)) return schemaShape(value.toJSON(), discriminatorKeys, propertyKey)
  if (value === null) return { type: 'null' }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      items: distinctSchemaShapes(
        value.map((item) =>
          item === undefined ? { type: 'null' } : schemaShape(item, discriminatorKeys),
        ),
      ),
    }
  }
  if (value === undefined) return { type: 'null' }
  if (typeof value !== 'object') {
    if (typeof value === 'string' && propertyKey && discriminatorKeys.has(propertyKey)) {
      return { type: 'string', const: value }
    }
    if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' }
    return { type: typeof value }
  }

  const entries = Object.entries(value).filter(([, nested]) => nested !== undefined)
  if (isIdKeyedMap(entries)) {
    return {
      type: 'id-map',
      values: distinctSchemaShapes(
        entries.map(([, nested]) => schemaShape(nested, discriminatorKeys)),
      ),
    }
  }

  return {
    type: 'object',
    properties: Object.fromEntries(
      entries
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, schemaShape(nested, discriminatorKeys, key)]),
    ),
  }
}

function stableSchemaStringify(value: unknown): string {
  return JSON.stringify(sortSchemaValue(value))
}

function distinctSchemaShapes(shapes: unknown[]): unknown[] {
  return Array.from(new Set(shapes.map(stableSchemaStringify)))
    .toSorted()
    .map((shape) => JSON.parse(shape) as unknown)
}

function hasToJSON(value: unknown): value is { toJSON(): unknown } {
  if (value == null || typeof value !== 'object') return false
  return typeof (value as { toJSON?: unknown }).toJSON === 'function'
}

function isIdKeyedMap(entries: [string, unknown][]): boolean {
  return (
    entries.length > 0 &&
    entries.every(([key, nested]) => isFixtureIdKey(key) && isPlainObject(nested))
  )
}

function isFixtureIdKey(key: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key) ||
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/i.test(key) ||
    /^[a-z][a-z0-9-]*-\d+$/i.test(key) ||
    /^[a-z]\d+$/i.test(key)
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function sortSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortSchemaValue)
  if (value == null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortSchemaValue(nested)]),
  )
}
