import { describe, expect, it } from 'vitest'

import { renderSchemaMarkdown } from './render-markdown.mts'
import { emptySnapshot } from './snapshot.test-helpers.mts'

describe('renderSchemaMarkdown — non-table sections', () => {
  it('preserves views, enums, extensions, function signatures, and policies in focused documents', () => {
    const files = renderSchemaMarkdown({
      ...emptySnapshot(),
      views: {
        widget_totals: {
          definition: 'SELECT owner_id FROM widgets',
          comment: 'Per-owner totals.',
          materialized: true,
        },
        item_names: {
          definition: 'SELECT name FROM items',
          comment: null,
          materialized: false,
        },
      },
      enums: {
        widget_status: { values: ['active', 'archived'] },
        item_kind: { values: ['tool'] },
      },
      extensions: { pgcrypto: { version: '1.3' }, uuid_ossp: { version: '1.1' } },
      functions: {
        set_updated_at: {
          definition:
            'CREATE FUNCTION set_updated_at()\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  RETURN NEW;\nEND;\n$function$',
        },
        ping: { definition: 'CREATE FUNCTION ping() RETURNS void LANGUAGE sql' },
      },
      policies: {
        'widgets.owner_read': {
          table: 'widgets',
          command: 'SELECT',
          pgRoles: ['authenticated'],
          using: 'owner_id = current_user_id()',
          withCheck: null,
        },
        'widgets.owner_write': {
          table: 'widgets',
          command: 'INSERT',
          pgRoles: ['authenticated'],
          using: null,
          withCheck: 'owner_id = current_user_id()',
        },
      },
    })

    expect(files.get('views.md')).toContain('## `widget_totals` (materialized)')
    expect(files.get('views.md')).toContain('Per-owner totals.')
    expect(files.get('views.md')).toContain('## `item_names`')
    expect(files.get('views.md')).not.toContain('item_names` (materialized)')
    expect(files.get('enums.md')).toContain('- `active`')
    expect(files.get('enums.md')!.indexOf('item_kind')).toBeLessThan(
      files.get('enums.md')!.indexOf('widget_status'),
    )
    expect(files.get('extensions.md')).toContain('| `pgcrypto` | 1.3 |')
    expect(files.get('extensions.md')!.indexOf('pgcrypto')).toBeLessThan(
      files.get('extensions.md')!.indexOf('uuid_ossp'),
    )
    expect(files.get('functions.md')).toContain('CREATE FUNCTION set_updated_at()')
    expect(files.get('functions.md')).not.toContain('RETURN NEW;')
    expect(files.get('functions.md')).toContain('CREATE FUNCTION ping() RETURNS void LANGUAGE sql')
    expect(files.get('policies.md')).toContain('- using: `owner_id = current_user_id()`')
    expect(files.get('policies.md')).toContain('- with check: `owner_id = current_user_id()`')
    expect(files.get('policies.md')).toContain('- using: _none_')
  })
})
