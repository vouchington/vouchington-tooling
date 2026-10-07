import { describe, expect, it } from 'vitest'
import { createPostgresReplayContext } from './replay-context.mts'
import type { SchemaSnapshot, SchemaTableSnapshot } from './types.mts'

function table(columns: SchemaTableSnapshot['columns']): SchemaTableSnapshot {
  return {
    relationKind: 'table',
    columns,
    primaryKey: null,
    uniqueConstraints: {},
    checkConstraints: {},
    foreignKeys: {},
    indexes: {},
    triggers: { before_update: 'CREATE TRIGGER before_update' },
    comment: null,
    physicalPartition: null,
    partition: null,
    growth: 'bounded',
  }
}

function column(generated: 'stored' | 'virtual' | null, expression: string | null) {
  return {
    type: 'text',
    nullable: true,
    defaultExpression: null,
    generatedExpression: expression,
    identity: null,
    generated,
    collation: null,
    comment: null,
    ordinalPosition: 1,
  }
}

function schema(columns: SchemaTableSnapshot['columns']): SchemaSnapshot {
  return {
    formatVersion: 2,
    tables: { topics: table(columns) },
    views: {},
    enums: {},
    extensions: {},
    functions: {},
    policies: {},
  }
}

describe('createPostgresReplayContext', () => {
  it('projects trigger text and nested STORED generated dependencies from injected facts', () => {
    const context = createPostgresReplayContext({
      schema: schema({
        search_vector: column('stored', "to_tsvector('simple', coalesce(alias, ''))"),
        score: column(
          'stored',
          'fn_wilson_score_lower_bound(votes_score_up, ((votes_score_up + votes_score_none) + votes_score_down))',
        ),
        json_date: column('stored', "((data ->> 'isoDate')::date)"),
        lifecycle_time: column(
          'stored',
          'CASE WHEN expired_at IS NOT NULL THEN expired_at ELSE revoked_at END',
        ),
        virtual_value: column('virtual', 'alias'),
        plain_value: column(null, null),
      }),
      generatedColumnReferences: [
        { table: 'topics', column: 'search_vector', sourceColumns: ['alias'] },
        {
          table: 'topics',
          column: 'score',
          sourceColumns: ['votes_score_up', 'votes_score_none', 'votes_score_down'],
        },
        { table: 'topics', column: 'json_date', sourceColumns: ['data'] },
        { table: 'topics', column: 'lifecycle_time', sourceColumns: ['expired_at', 'revoked_at'] },
      ],
    })

    expect(context.triggerTextsForTable('topics')).toEqual(['CREATE TRIGGER before_update'])
    expect(context.generatedDependenciesForTable('topics')).toEqual(
      new Map([
        ['search_vector', new Set(['alias'])],
        ['score', new Set(['votes_score_up', 'votes_score_none', 'votes_score_down'])],
        ['json_date', new Set(['data'])],
        ['lifecycle_time', new Set(['expired_at', 'revoked_at'])],
      ]),
    )
    expect(context.triggerTextsForTable('unknown')).toBeUndefined()
    expect(context.generatedDependenciesForTable('unknown')).toBeUndefined()
  })

  it('keeps a known table with no STORED dependencies as an empty map', () => {
    const context = createPostgresReplayContext({
      schema: schema({ virtual_value: column('virtual', 'alias') }),
      generatedColumnReferences: [],
    })

    expect(context.generatedDependenciesForTable('topics')).toEqual(new Map())
  })

  it('requires a fact for every STORED generated expression, including no-reference expressions', () => {
    const context = createPostgresReplayContext({
      schema: schema({ constant_value: column('stored', "'fixed'") }),
      generatedColumnReferences: [],
    })

    expect(() => context.generatedDependenciesForTable('topics')).toThrow(
      'Missing generated-column reference facts for topics.constant_value',
    )
  })
})
