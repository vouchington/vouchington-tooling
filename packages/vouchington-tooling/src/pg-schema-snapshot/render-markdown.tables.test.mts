import { describe, expect, it } from 'vitest'

import { renderSchemaMarkdown } from './render-markdown.mts'
import { emptySnapshot, widgetsTable } from './snapshot.test-helpers.mts'

describe('renderSchemaMarkdown — tables', () => {
  it('renders a directly indexable README and every non-table section document for an empty snapshot', () => {
    const files = renderSchemaMarkdown(emptySnapshot())

    expect(files.get('README.md')).toContain('# PostgreSQL Schema Snapshot')
    expect(files.get('README.md')).toContain('Generated schema snapshot. Do not hand-edit.')
    expect(files.get('README.md')).not.toContain('db:snapshot:update')
    expect(files.get('README.md')).toContain('[Views](views.md)')
    expect(files.get('views.md')).toContain('# Views\n\n[Schema index](README.md).\n\n_none_')
    expect(files.get('enums.md')).toContain('_none_')
    expect(files.get('extensions.md')).toContain('| Extension | Version |')
    expect(files.get('functions.md')).toContain('_none_')
    expect(files.get('policies.md')).toContain('_none_')
  })

  it('creates safe alphabetically ordered table leaves linked directly from the index', () => {
    const files = renderSchemaMarkdown({
      ...emptySnapshot(),
      tables: { widgets: widgetsTable(), aardvarks: widgetsTable() },
    })

    expect([...files.keys()]).toEqual([
      'README.md',
      'tables/aardvarks.md',
      'tables/widgets.md',
      'views.md',
      'enums.md',
      'extensions.md',
      'functions.md',
      'policies.md',
    ])
    expect(files.get('README.md')!.indexOf('aardvarks')).toBeLessThan(
      files.get('README.md')!.indexOf('widgets'),
    )
    expect(files.get('tables/widgets.md')).toContain('# Table `widgets`')
    expect(files.get('tables/widgets.md')).toContain('[Schema index](../README.md)')
  })

  it('rejects an unsafe table name before generating a path', () => {
    expect(() =>
      renderSchemaMarkdown({ ...emptySnapshot(), tables: { '../widgets': widgetsTable() } }),
    ).toThrow('safe Markdown filename')
  })

  it('renders table details and exactly one column table per table leaf', () => {
    const files = renderSchemaMarkdown({
      ...emptySnapshot(),
      tables: {
        widgets: widgetsTable({
          comment: 'Bounded widget catalog.',
          primaryKey: { definition: 'PRIMARY KEY (id)', columns: ['id'] },
          uniqueConstraints: {
            widgets_b_key: { definition: 'UNIQUE (b)', columns: ['b'] },
            widgets_a_key: { definition: 'UNIQUE (a)', columns: ['a'] },
          },
          checkConstraints: { widgets_total_check: 'CHECK (total >= 0)' },
          indexes: {
            idx_widgets__id: {
              definition: 'CREATE INDEX idx_widgets__id ON widgets USING btree (id)',
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
          },
          triggers: { widgets_touch: 'CREATE TRIGGER widgets_touch ...' },
          columns: {
            total: {
              type: 'integer',
              nullable: true,
              defaultExpression: null,
              generatedExpression: 'nextval(\n  1\n)',
              identity: 'always',
              generated: 'stored',
              collation: 'C',
              comment: 'Count | running total',
              ordinalPosition: 2,
            },
            id: {
              type: 'uuid',
              nullable: false,
              defaultExpression: 'gen_random_uuid()',
              generatedExpression: null,
              identity: null,
              generated: null,
              collation: null,
              comment: null,
              ordinalPosition: 1,
            },
          },
        }),
      },
    })
    const markdown = files.get('tables/widgets.md')!

    expect(markdown).toContain('Bounded widget catalog.')
    expect(markdown).toContain('Not partitioned — growth: bounded.')
    expect(markdown.match(/\| Column \| Type /gu)).toHaveLength(1)
    expect(markdown.indexOf('`id`')).toBeLessThan(markdown.indexOf('`total`'))
    expect(markdown).toContain('nextval(   1 )')
    expect(markdown).toContain('gen_random_uuid()')
    expect(markdown).toContain('Count \\| running total')
    expect(markdown.indexOf('widgets_a_key')).toBeLessThan(markdown.indexOf('widgets_b_key'))
    expect(markdown).toContain('widgets_total_check')
    expect(markdown).toContain('idx_widgets__id')
    expect(markdown).toContain('widgets_touch')
  })

  it('renders a partition descriptor without partition children', () => {
    const markdown = renderSchemaMarkdown({
      ...emptySnapshot(),
      tables: {
        widgets: widgetsTable({
          growth: 'unbounded',
          partition: {
            strategy: 'RANGE',
            key: 'id',
            children: 'monthly',
            retentionOwner: 'cleanup',
            accessClass: 'retention-window',
          },
        }),
      },
    }).get('tables/widgets.md')!

    expect(markdown).toContain(
      'RANGE partitioned on `id` (children: monthly, retention owner `cleanup`, access class: retention-window, growth: unbounded).',
    )
    expect(markdown).not.toMatch(/widgets__p_\d{4}_\d{2}/u)
  })

  it('renders list-range partitions with no retention owner', () => {
    const markdown = renderSchemaMarkdown({
      ...emptySnapshot(),
      tables: {
        items: widgetsTable({
          growth: 'unbounded',
          partition: {
            strategy: 'LIST -> RANGE',
            key: 'kind',
            children: 'list-default-range',
            retentionOwner: null,
            accessClass: 'intentional-fanout',
          },
        }),
      },
    }).get('tables/items.md')!

    expect(markdown).toContain(
      'LIST -> RANGE partitioned on `kind` (children: list-default-range, no retention owner, access class: intentional-fanout, growth: unbounded).',
    )
  })
})
