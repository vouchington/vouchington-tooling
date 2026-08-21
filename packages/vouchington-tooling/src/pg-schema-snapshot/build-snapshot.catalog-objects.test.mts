import { describe, expect, it } from 'vitest'

import { buildSchemaSnapshot } from './build-snapshot.mts'
import { catalog, emptyGrowth } from './snapshot.test-helpers.mts'

describe('buildSchemaSnapshot — enums, views, extensions, functions, policies', () => {
  it('groups enum values by enum name in their catalog sort order', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        enums: [
          { enum_name: 'widget_status', value: 'active', sort_order: 1 },
          { enum_name: 'widget_status', value: 'archived', sort_order: 2 },
        ],
      }),
      emptyGrowth(),
    )

    expect(snapshot.enums.widget_status).toEqual({ values: ['active', 'archived'] })
  })

  it('keys views by name and preserves materialized flag and comment', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        views: [
          {
            view_name: 'active_widgets',
            materialized: false,
            definition: 'SELECT * FROM widgets WHERE archived_at IS NULL',
            comment: 'Non-archived widgets.',
          },
          {
            view_name: 'widget_totals',
            materialized: true,
            definition: 'SELECT owner_id, sum(total) FROM widgets GROUP BY owner_id',
            comment: null,
          },
        ],
      }),
      emptyGrowth(),
    )

    expect(snapshot.views).toEqual({
      active_widgets: {
        definition: 'SELECT * FROM widgets WHERE archived_at IS NULL',
        comment: 'Non-archived widgets.',
        materialized: false,
      },
      widget_totals: {
        definition: 'SELECT owner_id, sum(total) FROM widgets GROUP BY owner_id',
        comment: null,
        materialized: true,
      },
    })
  })

  it('keys extensions by name with their installed version', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({ extensions: [{ extension_name: 'pgcrypto', version: '1.3' }] }),
      emptyGrowth(),
    )

    expect(snapshot.extensions).toEqual({ pgcrypto: { version: '1.3' } })
  })

  it('keys functions by bare name when there are no identity arguments', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        functions: [
          {
            function_name: 'set_updated_at',
            identity_arguments: '',
            definition: 'CREATE FUNCTION set_updated_at() ...',
          },
        ],
      }),
      emptyGrowth(),
    )

    expect(snapshot.functions).toEqual({
      set_updated_at: { definition: 'CREATE FUNCTION set_updated_at() ...' },
    })
  })

  it('keys overloaded functions by name and identity arguments so overloads do not collide', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        functions: [
          {
            function_name: 'to_slug',
            identity_arguments: 'text',
            definition: 'CREATE FUNCTION to_slug(text) ...',
          },
          {
            function_name: 'to_slug',
            identity_arguments: 'text, integer',
            definition: 'CREATE FUNCTION to_slug(text, integer) ...',
          },
        ],
      }),
      emptyGrowth(),
    )

    expect(Object.keys(snapshot.functions).toSorted()).toEqual([
      'to_slug(text)',
      'to_slug(text, integer)',
    ])
    expect(snapshot.functions['to_slug(text)']).toEqual({
      definition: 'CREATE FUNCTION to_slug(text) ...',
    })
    expect(snapshot.functions['to_slug(text, integer)']).toEqual({
      definition: 'CREATE FUNCTION to_slug(text, integer) ...',
    })
  })

  it('keys policies by table and policy name since policy names are only unique per table', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        policies: [
          {
            table_name: 'widgets',
            policy_name: 'owner_read',
            command: 'SELECT',
            pg_roles: ['authenticated'],
            using_expression: 'owner_id = current_user_id()',
            with_check_expression: null,
          },
          {
            table_name: 'items',
            policy_name: 'owner_read',
            command: 'SELECT',
            pg_roles: ['authenticated'],
            using_expression: 'owner_id = current_user_id()',
            with_check_expression: null,
          },
        ],
      }),
      emptyGrowth(),
    )

    expect(Object.keys(snapshot.policies).toSorted()).toEqual([
      'items.owner_read',
      'widgets.owner_read',
    ])
    expect(snapshot.policies['widgets.owner_read']).toEqual({
      table: 'widgets',
      command: 'SELECT',
      pgRoles: ['authenticated'],
      using: 'owner_id = current_user_id()',
      withCheck: null,
    })
  })
})
