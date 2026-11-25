import { describe, expect, it } from 'vitest'

import { checkRelationalStorage } from './index.mts'
import { SNAPSHOT_PATH, column, foreignKey, snapshot } from './relational-storage.test-helpers.mts'

describe('checkRelationalStorage column classification', () => {
  it.each(['json', 'jsonb', 'json[]', 'jsonb[]', 'json[][]', 'jsonb[][]'])(
    'accepts %s documents without typing each field',
    (type) => {
      expect(
        checkRelationalStorage(snapshot('records', { payload: column(type) }), {
          snapshotPath: SNAPSHOT_PATH,
        }),
      ).toEqual([])
    },
  )

  it('does not classify unrelated scalar, sized, or array types as JSON or references', () => {
    expect(
      checkRelationalStorage(
        snapshot('records', {
          label: column('text'),
          code: column('varchar(32)'),
          labels: column('text[]'),
        }),
        { snapshotPath: SNAPSHOT_PATH },
      ),
    ).toEqual([])
  })

  it('rejects UUID arrays, missing FKs, and encoded references with snapshotPath diagnostics', () => {
    const result = checkRelationalStorage(
      snapshot('records', {
        payload: column('jsonb'),
        tag_ids: column('uuid[]'),
        owner_id: column('uuid'),
        target_uuid: column('uuid'),
        work_key: column('text'),
      }),
      { snapshotPath: SNAPSHOT_PATH },
    )
    expect(result).toEqual([
      `::error file=${SNAPSHOT_PATH}::records.tag_ids: UUID array relationship needs concrete relational storage`,
      `::error file=${SNAPSHOT_PATH}::records.owner_id: UUID reference without a target foreign key needs concrete relational storage or an exact reviewed exception`,
      `::error file=${SNAPSHOT_PATH}::records.target_uuid: UUID reference without a target foreign key needs concrete relational storage or an exact reviewed exception`,
      `::error file=${SNAPSHOT_PATH}::records.work_key: encoded entity reference needs concrete relational storage or an exact reviewed exception`,
    ])
  })

  it('rejects primary and unique UUID references without a target FK and accepts composite FKs', () => {
    const unlinked = snapshot('child_records', { owner_id: column('uuid') })
    unlinked.tables.child_records!.primaryKey = {
      columns: ['owner_id'],
      definition: 'PRIMARY KEY (owner_id)',
    }
    unlinked.tables.child_records!.uniqueConstraints.owner_unique = {
      columns: ['owner_id'],
      definition: 'UNIQUE (owner_id)',
    }
    expect(checkRelationalStorage(unlinked, { snapshotPath: SNAPSHOT_PATH })).toEqual([
      expect.stringContaining(
        'child_records.owner_id: UUID reference without a target foreign key',
      ),
    ])

    const linked = snapshot('child_records', {
      owner_id: column('uuid'),
      owner_month: column('date'),
    })
    linked.tables.child_records!.foreignKeys.owner_fk = foreignKey('owner_id', {
      columns: ['owner_id', 'owner_month'],
      definition: 'FOREIGN KEY (owner_id, owner_month) REFERENCES owners (id, month)',
      referencedColumns: ['id', 'month'],
    })
    expect(checkRelationalStorage(linked, { snapshotPath: SNAPSHOT_PATH })).toEqual([])
  })

  it('rejects unresolved domain types before JSON, UUID-array, and relation classification', () => {
    const value = snapshot('records', {
      payload: column('document_json'),
      owner_id: column('owner_uuid'),
      tag_ids: column('uuid_list'),
    })
    const errors = checkRelationalStorage(value, { snapshotPath: SNAPSHOT_PATH })
    expect(errors).toEqual([
      `::error file=${SNAPSHOT_PATH}::records.payload: domain-backed type document_json must be resolved to its base type before relational classification`,
      `::error file=${SNAPSHOT_PATH}::records.owner_id: domain-backed type owner_uuid must be resolved to its base type before relational classification`,
      `::error file=${SNAPSHOT_PATH}::records.tag_ids: domain-backed type uuid_list must be resolved to its base type before relational classification`,
    ])
  })

  it('accepts schema enum types and caller-supplied extraKnownTypes', () => {
    const value = snapshot('records', {
      kind: column('record_kind'),
      email: column('CITEXT'),
    })
    value.enums = { record_kind: { values: ['note'] } }
    expect(
      checkRelationalStorage(value, {
        snapshotPath: SNAPSHOT_PATH,
        catalog: { extraKnownTypes: new Set([' citext ']) },
      }),
    ).toEqual([])
  })

  it('enforces shared primary key ownership rules for sole UUID id columns', () => {
    const shared = snapshot('profiles', { id: column('uuid') })
    shared.tables.profiles!.primaryKey = { columns: ['id'], definition: 'PRIMARY KEY (id)' }
    expect(checkRelationalStorage(shared, { snapshotPath: SNAPSHOT_PATH })).toEqual([
      expect.stringContaining('profiles.id: shared primary key without a target foreign key'),
    ])

    shared.tables.profiles!.foreignKeys.profiles_id_fkey = foreignKey('id')
    expect(checkRelationalStorage(shared, { snapshotPath: SNAPSHOT_PATH })).toEqual([])

    const byUuidv7 = snapshot('items', {
      id: column('uuid', { defaultExpression: 'uuidv7()' }),
    })
    byUuidv7.tables.items!.primaryKey = { columns: ['id'], definition: 'PRIMARY KEY (id)' }
    expect(checkRelationalStorage(byUuidv7, { snapshotPath: SNAPSHOT_PATH })).toEqual([])

    const byGenRandom = snapshot('tokens', {
      id: column('uuid', { defaultExpression: 'gen_random_uuid()' }),
    })
    byGenRandom.tables.tokens!.primaryKey = { columns: ['id'], definition: 'PRIMARY KEY (id)' }
    expect(checkRelationalStorage(byGenRandom, { snapshotPath: SNAPSHOT_PATH })).toEqual([])

    const byIdentity = snapshot('identities', {
      id: column('uuid', { identity: 'always' }),
    })
    byIdentity.tables.identities!.primaryKey = { columns: ['id'], definition: 'PRIMARY KEY (id)' }
    expect(checkRelationalStorage(byIdentity, { snapshotPath: SNAPSHOT_PATH })).toEqual([])

    const reviewedOwn = snapshot('sessions', { id: column('uuid') })
    reviewedOwn.tables.sessions!.primaryKey = { columns: ['id'], definition: 'PRIMARY KEY (id)' }
    expect(
      checkRelationalStorage(reviewedOwn, {
        snapshotPath: SNAPSHOT_PATH,
        catalog: { allowedOwnPrimaryUuids: new Set(['sessions.id']) },
      }),
    ).toEqual([])
  })

  it('classifies UUID encoded keys as missing-FK references and text encoded keys as encoded', () => {
    const encoded = snapshot('jobs', {
      entity_key: column('varchar(64)'),
      relation_key: column('text'),
      target_key: column('name'),
      numeric_key: column('integer'),
    })
    expect(checkRelationalStorage(encoded, { snapshotPath: SNAPSHOT_PATH })).toEqual([
      expect.stringContaining('jobs.entity_key: encoded entity reference'),
      expect.stringContaining('jobs.relation_key: encoded entity reference'),
      expect.stringContaining('jobs.target_key: encoded entity reference'),
    ])

    const uuidWorkKey = snapshot('jobs', { work_key: column('uuid') })
    const errors = checkRelationalStorage(uuidWorkKey, { snapshotPath: SNAPSHOT_PATH })
    expect(errors).toEqual([
      expect.stringContaining('jobs.work_key: UUID reference without a target foreign key'),
    ])
    expect(errors.join('\n')).not.toContain('encoded entity reference')

    uuidWorkKey.tables.jobs!.foreignKeys.work_fk = foreignKey('work_key')
    expect(checkRelationalStorage(uuidWorkKey, { snapshotPath: SNAPSHOT_PATH })).toEqual([])
  })

  it('flags uuid_value paired with kind and extraEncodedReferenceColumns only for exact keys', () => {
    const polymorphic = snapshot('attributes', {
      kind: column('text'),
      uuid_value: column('uuid'),
    })
    expect(checkRelationalStorage(polymorphic, { snapshotPath: SNAPSHOT_PATH })).toEqual([
      expect.stringContaining('attributes.uuid_value: encoded entity reference'),
    ])

    polymorphic.tables.attributes!.foreignKeys.uuid_value_fk = foreignKey('uuid_value')
    expect(checkRelationalStorage(polymorphic, { snapshotPath: SNAPSHOT_PATH })).toEqual([])

    const withoutKind = snapshot('standalone', { uuid_value: column('uuid') })
    expect(checkRelationalStorage(withoutKind, { snapshotPath: SNAPSHOT_PATH })).toEqual([])

    const catalog = { extraEncodedReferenceColumns: new Set(['legacy_targets.slot_key']) }
    expect(
      checkRelationalStorage(snapshot('legacy_targets', { slot_key: column('text') }), {
        snapshotPath: SNAPSHOT_PATH,
        catalog,
      }),
    ).toEqual([expect.stringContaining('legacy_targets.slot_key: encoded entity reference')])
    expect(
      checkRelationalStorage(snapshot('display_cards', { slot_key: column('text') }), {
        snapshotPath: SNAPSHOT_PATH,
        catalog,
      }),
    ).toEqual([])
  })

  it('applies exact reviewed exception catalogs to matching categories only', () => {
    const catalog = {
      allowedNonrelationUuids: new Set(['cursors.cursor_id']),
      allowedTokenCursorProtocolIds: new Map([
        ['votes.device_id', 'Client-issued device token.'],
        ['external_jobs.work_key', 'Provider idempotency key.'],
      ]),
      allowedAuditSnapshotIds: new Map([
        ['audit_events.client_id', 'Snapshot at write time.'],
        ['audit_events.work_key', 'Not valid for encoded text columns.'],
      ]),
    }

    const accepted = snapshot('cursors', { cursor_id: column('uuid') })
    accepted.tables.votes = snapshot('votes', { device_id: column('uuid') }).tables.votes!
    accepted.tables.external_jobs = snapshot('external_jobs', {
      work_key: column('text'),
    }).tables.external_jobs!
    accepted.tables.audit_events = snapshot('audit_events', {
      client_id: column('uuid'),
      work_key: column('text'),
    }).tables.audit_events!

    expect(
      checkRelationalStorage(accepted, {
        snapshotPath: SNAPSHOT_PATH,
        catalog,
        enforceCatalogFreshness: false,
      }),
    ).toEqual([expect.stringContaining('audit_events.work_key: encoded entity reference')])

    const otherTable = snapshot('other_records', {
      cursor_id: column('uuid'),
      device_id: column('uuid'),
      client_id: column('uuid'),
    })
    expect(
      checkRelationalStorage(otherTable, {
        snapshotPath: SNAPSHOT_PATH,
        catalog,
        enforceCatalogFreshness: false,
      }),
    ).toEqual([
      expect.stringContaining('other_records.cursor_id: UUID reference'),
      expect.stringContaining('other_records.device_id: UUID reference'),
      expect.stringContaining('other_records.client_id: UUID reference'),
    ])
  })
})
