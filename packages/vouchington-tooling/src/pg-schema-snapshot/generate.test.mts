import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { SchemaCatalog } from './catalog-queries.mts'
import { generateSchemaSnapshot, stableStringify, writeSchemaSnapshot } from './generate.mts'
import { renderSchemaMarkdown } from './render-markdown.mts'
import { emptyCatalog, emptyGrowth, widgetsTable } from './snapshot.test-helpers.mts'
import type { CatalogQuery, SchemaSnapshot } from './types.mts'

const snapshot: SchemaSnapshot = {
  formatVersion: 2,
  tables: {
    widgets: widgetsTable({
      primaryKey: { definition: 'PRIMARY KEY (id)', columns: ['id'] },
    }),
  },
  views: {},
  enums: {},
  extensions: {},
  functions: {},
  policies: {},
}

function catalogQueryFrom(rows: SchemaCatalog): CatalogQuery {
  return async <Row extends Record<string, unknown>>(sql: string) => {
    const table = sql.includes('readSchemaSnapshotTables')
      ? rows.tables
      : sql.includes('readSchemaSnapshotColumns')
        ? rows.columns
        : sql.includes('readSchemaSnapshotConstraints')
          ? rows.constraints
          : sql.includes('readSchemaSnapshotIndexes')
            ? rows.indexes
            : sql.includes('readSchemaSnapshotTriggers')
              ? rows.triggers
              : sql.includes('readSchemaSnapshotEnums')
                ? rows.enums
                : sql.includes('readSchemaSnapshotViews')
                  ? rows.views
                  : sql.includes('readSchemaSnapshotExtensions')
                    ? rows.extensions
                    : sql.includes('readSchemaSnapshotFunctions')
                      ? rows.functions
                      : sql.includes('readSchemaSnapshotPolicies')
                        ? rows.policies
                        : []
    return { rows: table as unknown as Row[] }
  }
}

describe('writeSchemaSnapshot', () => {
  const roots: string[] = []

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'schema-snapshot-generate-'))
    roots.push(root)
    return root
  }

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { force: true, recursive: true, maxRetries: 5 })),
    )
  })

  it('writes stable JSON and the complete focused Markdown tree', async () => {
    const root = await tempRoot()
    await writeSchemaSnapshot({ snapshot, markdown: renderSchemaMarkdown(snapshot), root })

    await expect(readFile(join(root, 'schema.json'), 'utf8')).resolves.toBe(
      stableStringify(snapshot),
    )
    await expect(readFile(join(root, 'markdown/README.md'), 'utf8')).resolves.toContain(
      '[`widgets`](tables/widgets.md)',
    )
    await expect(readFile(join(root, 'markdown/tables/widgets.md'), 'utf8')).resolves.toContain(
      '# Table `widgets`',
    )
  })

  it('accepts matching generated files in check mode', async () => {
    const root = await tempRoot()
    const markdown = renderSchemaMarkdown(snapshot)
    await writeSchemaSnapshot({ snapshot, markdown, root })
    await expect(
      writeSchemaSnapshot({ snapshot, markdown, check: true, root }),
    ).resolves.toBeUndefined()
  })

  it('reports missing, changed, legacy, and orphaned generated Markdown in check mode', async () => {
    const root = await tempRoot()
    const markdown = renderSchemaMarkdown(snapshot)
    await expect(writeSchemaSnapshot({ snapshot, markdown, check: true, root })).rejects.toThrow(
      'PostgreSQL schema snapshot is stale. Regenerate it and commit:',
    )
    await expect(writeSchemaSnapshot({ snapshot, markdown, check: true, root })).rejects.toThrow(
      join(root, 'markdown/tables/widgets.md'),
    )

    await writeSchemaSnapshot({ snapshot, markdown, root })
    await writeFile(join(root, 'markdown/tables/widgets.md'), '# Stale content\n')
    await mkdir(join(root, 'markdown/nested'), { recursive: true })
    await writeFile(join(root, 'markdown/nested/orphan.md'), '# Nested orphan\n')
    await writeFile(join(root, 'markdown/orphan.md'), '# Orphan\n')
    await writeFile(join(root, 'schema.md'), '# Legacy\n')

    await expect(writeSchemaSnapshot({ snapshot, markdown, check: true, root })).rejects.toThrow(
      'PostgreSQL schema snapshot is stale. Regenerate it and commit:',
    )
    await expect(writeSchemaSnapshot({ snapshot, markdown, check: true, root })).rejects.toThrow(
      join(root, 'markdown/tables/widgets.md'),
    )
    await expect(writeSchemaSnapshot({ snapshot, markdown, check: true, root })).rejects.toThrow(
      join(root, 'markdown/orphan.md'),
    )
    await expect(writeSchemaSnapshot({ snapshot, markdown, check: true, root })).rejects.toThrow(
      join(root, 'markdown/nested/orphan.md'),
    )
    await expect(writeSchemaSnapshot({ snapshot, markdown, check: true, root })).rejects.toThrow(
      join(root, 'schema.md'),
    )
  })

  it('removes only legacy and orphaned generated Markdown during update', async () => {
    const root = await tempRoot()
    const markdown = renderSchemaMarkdown(snapshot)
    await writeSchemaSnapshot({ snapshot, markdown, root })
    await mkdir(join(root, 'markdown/nested'), { recursive: true })
    await writeFile(join(root, 'markdown/nested/orphan.md'), '# Nested orphan\n')
    await writeFile(join(root, 'markdown/orphan.md'), '# Orphan\n')
    await writeFile(join(root, 'schema.md'), '# Legacy\n')

    await writeSchemaSnapshot({ snapshot, markdown, root })

    await expect(readFile(join(root, 'markdown/orphan.md'), 'utf8')).rejects.toThrow(/ENOENT/)
    await expect(readFile(join(root, 'markdown/nested/orphan.md'), 'utf8')).rejects.toThrow(
      /ENOENT/,
    )
    await expect(readFile(join(root, 'schema.md'), 'utf8')).rejects.toThrow(/ENOENT/)
    await expect(readFile(join(root, 'schema.json'), 'utf8')).resolves.toBe(
      stableStringify(snapshot),
    )
  })

  it('rejects generated Markdown paths outside the dedicated subtree', async () => {
    const root = await tempRoot()
    await expect(
      writeSchemaSnapshot({
        snapshot,
        markdown: new Map([['../escape.md', '# Escape\n']]),
        root,
      }),
    ).rejects.toThrow('Unsafe generated PostgreSQL schema Markdown path')
    await expect(readFile(join(root, 'escape.md'), 'utf8')).rejects.toThrow(/ENOENT/)
  })

  it('rejects Markdown paths that are not .md files or are absolute', async () => {
    const root = await tempRoot()
    await expect(
      writeSchemaSnapshot({
        snapshot,
        markdown: new Map([['tables/widgets.txt', 'not markdown']]),
        root,
      }),
    ).rejects.toThrow('Unsafe generated PostgreSQL schema Markdown path')
    await expect(
      writeSchemaSnapshot({
        snapshot,
        markdown: new Map([[join(root, 'escape.md'), '# Escape\n']]),
        root,
      }),
    ).rejects.toThrow('Unsafe generated PostgreSQL schema Markdown path')
  })

  it('stableStringify sorts nested keys and arrays', () => {
    expect(stableStringify({ b: 1, a: [{ z: 2, y: 3 }] })).toBe(
      `${JSON.stringify({ a: [{ y: 3, z: 2 }], b: 1 }, null, 2)}\n`,
    )
  })

  it('applies custom stringify and format callbacks', async () => {
    const root = await tempRoot()
    await writeSchemaSnapshot({
      snapshot,
      markdown: renderSchemaMarkdown(snapshot),
      root,
      stringify: () => '{"ok":true}\n',
      format: async (path, raw) => (path.endsWith('.json') ? raw.replace('true', 'false') : raw),
    })
    await expect(readFile(join(root, 'schema.json'), 'utf8')).resolves.toBe('{"ok":false}\n')
  })

  it('writes a snapshot from a catalog query', async () => {
    const root = await tempRoot()
    const query = catalogQueryFrom(emptyCatalog())
    const growth = emptyGrowth()
    await expect(generateSchemaSnapshot({ query, growth, root, check: true })).rejects.toThrow(
      'PostgreSQL schema snapshot is stale. Regenerate it and commit:',
    )
    await generateSchemaSnapshot({ query, growth, root })
    await expect(readFile(join(root, 'schema.json'), 'utf8')).resolves.toBe(
      stableStringify({
        formatVersion: 2,
        tables: {},
        views: {},
        enums: {},
        extensions: {},
        functions: {},
        policies: {},
      }),
    )
    await expect(
      generateSchemaSnapshot({ query, growth, root, check: true }),
    ).resolves.toBeUndefined()
  })
})
