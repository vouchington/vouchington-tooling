import { describe, expect, it } from 'vitest'
import { detectRenamedIndexes, indexShapeKey } from './index-rename-detect.mts'
import type { SchemaSnapshot } from './types.mts'

const EMPTY_TABLE = {
  relationKind: 'table' as const,
  columns: {},
  primaryKey: null,
  uniqueConstraints: {},
  checkConstraints: {},
  foreignKeys: {},
  triggers: {},
  comment: null,
  physicalPartition: null,
  partition: null,
  growth: 'bounded' as const,
}

function snapshot(indexDefinitions: Record<string, string>): SchemaSnapshot {
  return {
    formatVersion: 2,
    tables: {
      widgets: {
        ...EMPTY_TABLE,
        indexes: Object.fromEntries(
          Object.entries(indexDefinitions).map(([name, definition]) => [
            name,
            {
              definition,
              accessMethod: 'btree',
              unique: false,
              primary: false,
              constraintBacked: false,
              valid: true,
              ready: true,
              keys: [],
              includedColumns: [],
              predicate: null,
            },
          ]),
        ),
      },
    },
    views: {},
    enums: {},
    extensions: {},
    functions: {},
    policies: {},
  }
}

describe('indexShapeKey', () => {
  it('strips a bare index name, leaving everything else byte-exact', () => {
    const definition = 'CREATE INDEX idx_widgets__name ON public.widgets USING btree (name)'
    expect(indexShapeKey('idx_widgets__name', definition)).toBe(
      'CREATE INDEX <name> ON public.widgets USING btree (name)',
    )
  })

  it('strips a quoted index name identically to its unquoted form', () => {
    const bare = 'CREATE UNIQUE INDEX idx_widgets__name ON public.widgets USING btree (name)'
    const quoted = 'CREATE UNIQUE INDEX "idx_widgets__name" ON public.widgets USING btree (name)'
    expect(indexShapeKey('idx_widgets__name', quoted)).toBe(
      indexShapeKey('idx_widgets__name', bare),
    )
  })

  it('strips a name that is the last token in the definition', () => {
    expect(indexShapeKey('idx', 'CREATE INDEX idx')).toBe('CREATE INDEX <name>')
  })

  it('throws when the name does not match the token following the marker', () => {
    const definition = 'CREATE INDEX idx_widgets__name ON public.widgets USING btree (name)'
    expect(() => indexShapeKey('idx_widgets__other', definition)).toThrow(
      /does not match the token following/,
    )
  })

  it('throws when the bare name is only a prefix of the actual token, not the whole name', () => {
    const definition = 'CREATE INDEX idx_widgets__name_v2 ON public.widgets USING btree (name)'
    expect(() => indexShapeKey('idx_widgets__name', definition)).toThrow(
      /does not match the token following/,
    )
  })

  it('throws when no " INDEX " marker is present', () => {
    expect(() => indexShapeKey('idx_widgets__name', 'not an index definition')).toThrow(
      /could not find/,
    )
  })
})

describe('detectRenamedIndexes', () => {
  it('reports a base index whose name disappeared but whose shape reappears under a new name', () => {
    const base = snapshot({
      idx_widgets__name: 'CREATE INDEX idx_widgets__name ON public.widgets USING btree (name)',
    })
    const head = snapshot({
      idx_widgets__name_v2:
        'CREATE INDEX idx_widgets__name_v2 ON public.widgets USING btree (name)',
    })
    expect(detectRenamedIndexes({ base, head })).toEqual([
      {
        table: 'widgets',
        retiredName: 'idx_widgets__name',
        retiredDefinition: base.tables.widgets!.indexes.idx_widgets__name!.definition,
        renamedTo: 'idx_widgets__name_v2',
      },
    ])
  })

  it('does not flag a same-named index whose shape changed', () => {
    const base = snapshot({
      idx_widgets__name: 'CREATE INDEX idx_widgets__name ON public.widgets USING btree (name)',
    })
    const head = snapshot({
      idx_widgets__name: 'CREATE INDEX idx_widgets__name ON public.widgets USING btree (name, id)',
    })
    expect(detectRenamedIndexes({ base, head })).toEqual([])
  })

  it('does not flag an index removed outright with no shape match at head', () => {
    const base = snapshot({
      idx_widgets__name: 'CREATE INDEX idx_widgets__name ON public.widgets USING btree (name)',
    })
    const head = snapshot({})
    expect(detectRenamedIndexes({ base, head })).toEqual([])
  })

  it('reports one entry per surviving name sharing the retired shape', () => {
    const base = snapshot({
      idx_widgets__name: 'CREATE INDEX idx_widgets__name ON public.widgets USING btree (name)',
    })
    const head = snapshot({
      idx_widgets__name_a: 'CREATE INDEX idx_widgets__name_a ON public.widgets USING btree (name)',
      idx_widgets__name_b: 'CREATE INDEX idx_widgets__name_b ON public.widgets USING btree (name)',
    })
    const renames = detectRenamedIndexes({ base, head })
    expect(renames.map((rename) => rename.renamedTo).toSorted()).toEqual([
      'idx_widgets__name_a',
      'idx_widgets__name_b',
    ])
  })
})
