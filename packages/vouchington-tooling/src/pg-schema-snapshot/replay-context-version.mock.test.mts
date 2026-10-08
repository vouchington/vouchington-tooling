import { readFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createPostgresReplayContextFromSchema } from './replay-context.mts'
import type { SchemaSnapshot } from './types.mts'

vi.mock<typeof import('node:fs/promises')>(import('node:fs/promises'), async (importOriginal) => {
  const original = await importOriginal()
  const mocked = { ...original }
  vi.spyOn(mocked, 'readFile')
  return mocked
})

afterEach(() => vi.mocked(readFile).mockReset())

const snapshot: SchemaSnapshot = {
  formatVersion: 2,
  tables: {
    items: {
      relationKind: 'table',
      columns: {
        derived: {
          type: 'integer',
          nullable: true,
          defaultExpression: null,
          generatedExpression: 'input + 1',
          identity: null,
          generated: 'stored',
          collation: null,
          comment: null,
          ordinalPosition: 1,
        },
      },
      primaryKey: null,
      uniqueConstraints: {},
      checkConstraints: {},
      foreignKeys: {},
      indexes: {},
      triggers: {},
      comment: null,
      physicalPartition: null,
      partition: null,
      growth: 'bounded',
    },
  },
  views: {},
  enums: {},
  extensions: {},
  functions: {},
  policies: {},
}

it.each(['0.78.0', '0.81.0-rc.1'])(
  'rejects incompatible parser %s before collecting snapshot facts',
  async (version) => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ version }))
    await expect(createPostgresReplayContextFromSchema(snapshot)).rejects.toThrow(
      'createPostgresReplayContextFromSchema requires no-mistakes >=0.81.0',
    )
  },
)

it('uses a compatible parser to collect dependencies', async () => {
  vi.mocked(readFile).mockResolvedValue(JSON.stringify({ version: '0.81.0' }))
  const context = await createPostgresReplayContextFromSchema(snapshot)
  expect(context.generatedDependenciesForTable('items')).toEqual(
    new Map([['derived', new Set(['input'])]]),
  )
})

it('does not resolve peer metadata for snapshots without generated expressions', async () => {
  const context = await createPostgresReplayContextFromSchema({ ...snapshot, tables: {} })
  expect(context.generatedDependenciesForTable('unknown')).toBeUndefined()
  expect(readFile).not.toHaveBeenCalled()
})
