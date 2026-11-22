import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildSchemaSnapshot } from './build-snapshot.mts'
import { loadSchemaSnapshot } from './load-snapshot.mts'
import {
  catalog,
  emptySnapshot,
  widgetsCatalogTable,
  widgetsGrowth,
  widgetsTable,
} from './snapshot.test-helpers.mts'
import type { PartitionPolicy } from './types.mts'
import { validateSchemaSnapshot } from './validate-snapshot.mts'

const snapshotPath = 'data/schema.json'
const options = { snapshotPath }

const partitioned = (partition: unknown) => ({
  ...emptySnapshot(),
  tables: {
    widgets: widgetsTable({
      relationKind: 'partitioned table',
      physicalPartition: { strategy: 'range', key: 'id' },
      partition: partition as PartitionPolicy,
    }),
  },
})
const policy = (overrides: Partial<PartitionPolicy> = {}): PartitionPolicy => ({
  strategy: 'RANGE',
  key: 'id',
  children: 'default',
  retentionOwner: 'anyOwner',
  accessClass: 'anyClass',
  ...overrides,
})

describe('validateSchemaSnapshot', () => {
  it('accepts real buildSchemaSnapshot output', () => {
    const built = buildSchemaSnapshot(
      catalog({ tables: [widgetsCatalogTable('p')] }),
      widgetsGrowth(),
    )
    expect(validateSchemaSnapshot(built, options)).toEqual({ snapshot: built, errors: [] })
  })

  it('accepts every policy value the published type allows by default', () => {
    const value = partitioned(
      policy({ strategy: 'LIST -> RANGE', children: 'list-default-range', retentionOwner: null }),
    )
    expect(validateSchemaSnapshot(value, options).errors).toEqual([])
  })

  it('narrows policy values with partitionPolicy options', () => {
    const narrow = {
      snapshotPath,
      partitionPolicy: {
        strategies: ['RANGE'],
        children: ['default', 'monthly'],
        retentionOwners: ['cleanupPartitions'],
        accessClasses: ['target-scoped'],
      },
    } as const
    const ok = policy({ retentionOwner: 'cleanupPartitions', accessClass: 'target-scoped' })
    expect(validateSchemaSnapshot(partitioned(ok), narrow).errors).toEqual([])
    expect(
      validateSchemaSnapshot(partitioned({ ...ok, retentionOwner: null }), narrow).errors,
    ).toEqual([])
    const bad = policy({
      strategy: 'LIST -> RANGE',
      children: 'list-default-range',
      retentionOwner: 'unknown',
      accessClass: 'wrong',
    })
    const errors = validateSchemaSnapshot(partitioned(bad), narrow).errors
    for (const field of ['strategy', 'children', 'retentionOwner', 'accessClass']) {
      expect(errors).toContainEqual(expect.stringContaining(`tables.widgets.partition.${field}`))
    }
  })

  it('rejects a non-object snapshot and a bad version', () => {
    expect(validateSchemaSnapshot([], options).errors).toEqual([
      `::error file=${snapshotPath}::${snapshotPath}: snapshot must be an object`,
    ])
    const result = validateSchemaSnapshot(
      { ...emptySnapshot(), formatVersion: 1, tables: { posts: {} }, views: { v: 1 } },
      options,
    )
    expect(result.snapshot).toBeNull()
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('formatVersion must be 2'),
        expect.stringContaining('tables.posts.columns must be an object'),
        expect.stringContaining('views.v must be an object'),
      ]),
    )
  })

  it('reports malformed nested facts with their paths', () => {
    const table = widgetsTable({
      relationKind: 'bogus' as never,
      growth: 'huge' as never,
      columns: { id: { type: 'uuid' } as never, bad: 1 as never },
      primaryKey: { definition: 'PK', columns: [1] } as never,
      foreignKeys: { fk: { onUpdate: 'explode' } as never },
      indexes: {
        i: { keys: [{ column: 'id' }], valid: 'yes' } as never,
        j: 1 as never,
      },
      physicalPartition: { strategy: 'unknown', key: 1 } as never,
      partition: 1 as never,
    })
    const value = {
      ...emptySnapshot(),
      tables: { widgets: table },
      views: { v: { definition: 'SELECT 1', comment: null, materialized: 'no' } },
      enums: { e: { values: ['a', 1] } },
      extensions: { x: { version: 17 } },
      functions: { f: { definition: null } },
      policies: {
        p: { table: 't', command: 'SELECT', pgRoles: [], using: false, withCheck: null },
      },
    }
    const errors = validateSchemaSnapshot(value, options).errors.join('\n')
    for (const path of [
      'tables.widgets.relationKind',
      'tables.widgets.growth',
      'tables.widgets.columns.id.nullable',
      'tables.widgets.columns.bad must be an object',
      'tables.widgets.primaryKey.columns[0]',
      'tables.widgets.foreignKeys.fk.onUpdate',
      'tables.widgets.indexes.i.keys[0].nullsFirst',
      'tables.widgets.indexes.i.valid',
      'tables.widgets.indexes.j must be an object',
      'tables.widgets.physicalPartition.strategy',
      'tables.widgets.partition must be an object',
      'views.v.materialized',
      'enums.e.values[1]',
      'extensions.x.version',
      'functions.f.definition',
      'policies.p.using',
    ]) {
      expect(errors).toContain(`${snapshotPath}: ${path}`)
    }
  })
})

describe('loadSchemaSnapshot', () => {
  it('accepts an injected snapshot without reading files', () => {
    const snapshot = emptySnapshot()
    expect(
      loadSchemaSnapshot({ repoRoot: '/missing', trackedFiles: new Set(), snapshot, snapshotPath }),
    ).toEqual({ snapshot, errors: [] })
  })

  it('fails closed when the snapshot is untracked', () => {
    const result = loadSchemaSnapshot({
      repoRoot: '/missing',
      trackedFiles: new Set(),
      snapshotPath,
    })
    expect(result.snapshot).toBeNull()
    expect(result.errors).toEqual([expect.stringContaining('must be tracked')])
  })

  it('fails closed on unreadable JSON and validates tracked files', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'schema-snapshot-'))
    const load = () =>
      loadSchemaSnapshot({
        repoRoot,
        trackedFiles: new Set(['schema.json']),
        snapshotPath: 'schema.json',
      })
    expect(load().errors).toEqual([expect.stringContaining('could not read valid JSON')])
    writeFileSync(join(repoRoot, 'schema.json'), '{nope')
    expect(load().errors).toEqual([expect.stringContaining('could not read valid JSON')])
    writeFileSync(join(repoRoot, 'schema.json'), JSON.stringify(emptySnapshot()))
    expect(load().errors).toEqual([])
  })
})
