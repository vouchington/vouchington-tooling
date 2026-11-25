import { describe, expect, it } from 'vitest'

import {
  checkRelationalStorage,
  type GeneratedFkAlias,
  type GeneratedSelfRootAlias,
} from './index.mts'
import {
  SNAPSHOT_PATH,
  column,
  foreignKey,
  plainTable,
  snapshot,
} from './relational-storage.test-helpers.mts'

const FK_ALIAS: GeneratedFkAlias = {
  expression: 'COALESCE(alpha_id, beta_id, gamma_id)',
  oneTargetCheck: 'num_nonnulls(alpha_id, beta_id, gamma_id) = 1',
  sourceColumns: ['alpha_id', 'beta_id', 'gamma_id'],
}

const SELF_ROOT_ALIAS: GeneratedSelfRootAlias = {
  expression: 'case when (parent_id is null) then id else null::uuid end',
  primaryKeyColumn: 'id',
  selfReferenceColumn: 'parent_id',
}

function makeGeneratedFkAliasSchema(checkDefinition: string) {
  const value = snapshot('aside_items', {
    alpha_id: column('uuid'),
    beta_id: column('uuid'),
    gamma_id: column('uuid'),
    entity_id: column('uuid', { generatedExpression: FK_ALIAS.expression }),
  })
  for (const name of FK_ALIAS.sourceColumns) {
    value.tables.aside_items!.foreignKeys[`${name}_fk`] = foreignKey(name)
  }
  value.tables.aside_items!.checkConstraints.one_target = checkDefinition
  return value
}

function makeSelfRootSchema() {
  const value = snapshot('nodes', {
    id: column('uuid', { nullable: false, defaultExpression: 'uuidv7()' }),
    parent_id: column('uuid'),
    root_id: column('uuid', {
      generatedExpression: 'CASE WHEN (parent_id IS NULL) THEN id ELSE NULL::uuid END',
      generated: 'stored',
    }),
  })
  value.tables.nodes!.primaryKey = { columns: ['id'], definition: 'PRIMARY KEY (id)' }
  value.tables.nodes!.foreignKeys.root_fk = foreignKey('parent_id', {
    definition: 'FOREIGN KEY (parent_id) REFERENCES nodes(root_id)',
    referencedTable: 'nodes',
    referencedColumns: ['root_id'],
    onDelete: 'set null',
  })
  return value
}

describe('checkRelationalStorage generated aliases', () => {
  it('accepts an exact generated FK alias and rejects altered expressions or checks', () => {
    const catalog = { generatedFkAliases: new Map([['aside_items.entity_id', FK_ALIAS]]) }
    const valid = makeGeneratedFkAliasSchema(
      'CHECK ((num_nonnulls(alpha_id, beta_id, gamma_id) = 1))',
    )
    expect(checkRelationalStorage(valid, { snapshotPath: SNAPSHOT_PATH, catalog })).toEqual([])

    valid.tables.aside_items!.columns.entity_id!.generatedExpression =
      'COALESCE(gen_random_uuid(), alpha_id)'
    expect(
      checkRelationalStorage(valid, {
        snapshotPath: SNAPSHOT_PATH,
        catalog,
        enforceCatalogFreshness: false,
      }),
    ).toEqual([expect.stringContaining('aside_items.entity_id: UUID reference')])
  })

  it.each([
    'CHECK ((num_nonnulls(alpha_id, beta_id, gamma_id) >= 1))',
    'CHECK ((num_nonnulls(gamma_id, alpha_id, beta_id) = 1))',
    'CHECK ((num_nonnulls(alpha_id, beta_id) = 1))',
    'CHECK ((num_nonnulls(alpha_id, beta_id, gamma_id) = 1) AND (true))',
    'CHECK ((num_nonnulls(alpha_id, beta_id, gamma_id) = 1)',
  ])('rejects a generated FK alias with non-exact check: %s', (definition) => {
    const catalog = { generatedFkAliases: new Map([['aside_items.entity_id', FK_ALIAS]]) }
    const value = makeGeneratedFkAliasSchema(definition)
    expect(
      checkRelationalStorage(value, {
        snapshotPath: SNAPSHOT_PATH,
        catalog,
        enforceCatalogFreshness: false,
      }),
    ).toEqual([expect.stringContaining('aside_items.entity_id: UUID reference')])
  })

  it('accepts an exact generated self-root alias and rejects altered columns or FKs', () => {
    const catalog = { generatedSelfRootAliases: new Map([['nodes.root_id', SELF_ROOT_ALIAS]]) }
    expect(
      checkRelationalStorage(makeSelfRootSchema(), { snapshotPath: SNAPSHOT_PATH, catalog }),
    ).toEqual([])

    const writable = makeSelfRootSchema()
    writable.tables.nodes!.columns.root_id!.generatedExpression = null
    writable.tables.nodes!.columns.root_id!.generated = null
    expect(
      checkRelationalStorage(writable, {
        snapshotPath: SNAPSHOT_PATH,
        catalog,
        enforceCatalogFreshness: false,
      }),
    ).toEqual([expect.stringContaining('nodes.root_id: UUID reference')])

    const alteredExpression = makeSelfRootSchema()
    alteredExpression.tables.nodes!.columns.root_id!.generatedExpression =
      'CASE WHEN parent_id IS NOT NULL THEN id ELSE NULL::uuid END'
    expect(
      checkRelationalStorage(alteredExpression, {
        snapshotPath: SNAPSHOT_PATH,
        catalog,
        enforceCatalogFreshness: false,
      }),
    ).toEqual([expect.stringContaining('nodes.root_id: UUID reference')])
  })

  it.each([
    ['wrong source column', ['id'], 'nodes', ['root_id'], true],
    ['wrong target table', ['parent_id'], 'other_nodes', ['root_id'], true],
    ['wrong target column', ['parent_id'], 'nodes', ['id'], true],
    ['unvalidated FK', ['parent_id'], 'nodes', ['root_id'], false],
  ])(
    'rejects a generated self-root alias with %s',
    (_label, columns, referencedTable, referencedColumns, validated) => {
      const catalog = { generatedSelfRootAliases: new Map([['nodes.root_id', SELF_ROOT_ALIAS]]) }
      const value = makeSelfRootSchema()
      value.tables.nodes!.foreignKeys.root_fk = {
        ...value.tables.nodes!.foreignKeys.root_fk!,
        columns,
        referencedTable,
        referencedColumns,
        validated,
      }
      expect(
        checkRelationalStorage(value, {
          snapshotPath: SNAPSHOT_PATH,
          catalog,
          enforceCatalogFreshness: false,
        }),
      ).toEqual(expect.arrayContaining([expect.stringContaining('nodes.root_id: UUID reference')]))
    },
  )

  it('rejects a generated self-root alias without a matching sole primary key or on another table', () => {
    const catalog = { generatedSelfRootAliases: new Map([['nodes.root_id', SELF_ROOT_ALIAS]]) }

    const noPrimaryKey = makeSelfRootSchema()
    noPrimaryKey.tables.nodes!.primaryKey = null
    expect(
      checkRelationalStorage(noPrimaryKey, {
        snapshotPath: SNAPSHOT_PATH,
        catalog,
        enforceCatalogFreshness: false,
      }),
    ).toEqual([expect.stringContaining('nodes.root_id: UUID reference')])

    const compositePrimaryKey = makeSelfRootSchema()
    compositePrimaryKey.tables.nodes!.primaryKey!.columns = ['id', 'parent_id']
    expect(
      checkRelationalStorage(compositePrimaryKey, {
        snapshotPath: SNAPSHOT_PATH,
        catalog,
        enforceCatalogFreshness: false,
      }),
    ).toEqual([expect.stringContaining('nodes.root_id: UUID reference')])

    const uncataloged = makeSelfRootSchema()
    uncataloged.tables.other_nodes = structuredClone(uncataloged.tables.nodes!)
    expect(
      checkRelationalStorage(uncataloged, {
        snapshotPath: SNAPSHOT_PATH,
        catalog,
        enforceCatalogFreshness: false,
      }),
    ).toEqual([expect.stringContaining('other_nodes.root_id: UUID reference')])
  })
})

describe('checkRelationalStorage catalog freshness', () => {
  it('passes freshness when every catalog entry matches live observed columns', () => {
    const value = makeSelfRootSchema()
    value.tables.aside_items = makeGeneratedFkAliasSchema(
      'CHECK (num_nonnulls(alpha_id, beta_id, gamma_id) = 1)',
    ).tables.aside_items!
    value.tables.events = plainTable({
      payload: column('jsonb'),
      cursor_id: column('uuid'),
      device_id: column('uuid'),
      client_id: column('uuid'),
      work_key: column('text'),
    })
    value.tables.sessions = plainTable({ id: column('uuid') })
    value.tables.sessions.primaryKey = { columns: ['id'], definition: 'PRIMARY KEY (id)' }

    expect(
      checkRelationalStorage(value, {
        snapshotPath: SNAPSHOT_PATH,
        catalog: {
          allowedOpaqueJson: new Set(['events.payload']),
          allowedNonrelationUuids: new Set(['events.cursor_id']),
          allowedOwnPrimaryUuids: new Set(['sessions.id']),
          allowedTokenCursorProtocolIds: new Set(['events.device_id', 'events.work_key']),
          allowedAuditSnapshotIds: new Set(['events.client_id']),
          generatedFkAliases: new Map([['aside_items.entity_id', FK_ALIAS]]),
          generatedSelfRootAliases: new Map([['nodes.root_id', SELF_ROOT_ALIAS]]),
        },
      }),
    ).toEqual([])
  })

  it('reports stale, duplicate, and invalid catalog entries when freshness is enabled', () => {
    const value = snapshot('events', {
      device_id: column('uuid'),
      shared_id: column('uuid'),
      audit_id: column('uuid'),
    })
    value.tables.events!.foreignKeys.device_fk = foreignKey('device_id')

    const catalog = {
      allowedOpaqueJson: new Set(['events.missing_json']),
      allowedNonrelationUuids: new Set(['events.shared_id', 'events.stale_nonrelation_id']),
      allowedOwnPrimaryUuids: new Set(['events.id']),
      allowedTokenCursorProtocolIds: new Map([
        ['events.device_id', 'Gained an FK.'],
        ['events.shared_id', 'Duplicates nonrelation UUID.'],
        ['events.audit_id', 'Duplicates audit snapshot.'],
      ]),
      allowedAuditSnapshotIds: new Map([
        ['events.audit_id', 'Duplicates token catalog.'],
        ['events.stale_audit_id', 'Column does not exist.'],
      ]),
      generatedFkAliases: new Map([
        ['events.missing_alias_id', FK_ALIAS],
        ['malformed', FK_ALIAS],
        ['.missing_table', FK_ALIAS],
        ['constructor.id', FK_ALIAS],
      ]),
      generatedSelfRootAliases: new Map([['nodes.root_id', SELF_ROOT_ALIAS]]),
    }

    const errors = checkRelationalStorage(value, { snapshotPath: SNAPSHOT_PATH, catalog })
    expect(errors).toEqual([
      `::error file=${SNAPSHOT_PATH}::events.missing_json: stale opaque JSON catalog entry; remove it`,
      `::error file=${SNAPSHOT_PATH}::events.stale_nonrelation_id: stale nonrelationship UUID catalog entry; remove it`,
      `::error file=${SNAPSHOT_PATH}::events.id: stale own primary UUID catalog entry; remove it`,
      `::error file=${SNAPSHOT_PATH}::events.device_id: stale token, cursor or protocol identifier catalog entry; remove it`,
      `::error file=${SNAPSHOT_PATH}::events.stale_audit_id: stale audit snapshot identifier catalog entry; remove it`,
      `::error file=${SNAPSHOT_PATH}::events.shared_id: duplicate reviewed identifier catalog entry`,
      `::error file=${SNAPSHOT_PATH}::events.audit_id: duplicate reviewed identifier catalog entry`,
      `::error file=${SNAPSHOT_PATH}::events.missing_alias_id: stale or invalid generated FK alias catalog entry: ${FK_ALIAS.expression}; ${FK_ALIAS.oneTargetCheck}`,
      `::error file=${SNAPSHOT_PATH}::malformed: stale or invalid generated FK alias catalog entry: ${FK_ALIAS.expression}; ${FK_ALIAS.oneTargetCheck}`,
      `::error file=${SNAPSHOT_PATH}::.missing_table: stale or invalid generated FK alias catalog entry: ${FK_ALIAS.expression}; ${FK_ALIAS.oneTargetCheck}`,
      `::error file=${SNAPSHOT_PATH}::constructor.id: stale or invalid generated FK alias catalog entry: ${FK_ALIAS.expression}; ${FK_ALIAS.oneTargetCheck}`,
      `::error file=${SNAPSHOT_PATH}::nodes.root_id: stale or invalid generated self-root alias catalog entry: ${SELF_ROOT_ALIAS.expression}`,
    ])

    expect(
      checkRelationalStorage(value, {
        snapshotPath: SNAPSHOT_PATH,
        catalog,
        enforceCatalogFreshness: false,
      }),
    ).toEqual([])
  })
})
