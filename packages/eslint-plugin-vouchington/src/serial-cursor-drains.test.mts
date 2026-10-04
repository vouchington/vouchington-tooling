import { describe, expect, it } from 'vitest'
import { lintRule, messageIds } from './lint-rule.test-helpers.mts'
import { resolveSerialDrainOptions } from './serial-cursor-drains.mts'

const OPTIONS = { functions: ['writeRows'], includeFiles: ['src/export.js'], include: [] }

describe('serial-cursor-drains', () => {
  it.each(['all', 'allSettled', 'any', 'race'])(
    'rejects eager %s in a selected drain',
    async (method) => {
      for (const iterator of ['map', 'flatMap', 'forEach']) {
        const result = await lintRule(
          'serial-cursor-drains',
          `async function writeRows() { await Promise.${method}(rows.${iterator}(drain)) }`,
          OPTIONS,
          'src/export.js',
        )
        expect(messageIds(result)).toEqual(['serial'])
      }
    },
  )

  it('recognizes named variable functions and bracket member names', async () => {
    expect(
      messageIds(
        await lintRule(
          'serial-cursor-drains',
          `const writeRows = async () => Promise['all'](rows['map'](drain))`,
          OPTIONS,
          'src/export.js',
        ),
      ),
    ).toEqual(['serial'])
    expect(
      messageIds(
        await lintRule(
          'serial-cursor-drains',
          `const writeRows = async function () { return Promise.all(rows.map(drain)) }`,
          OPTIONS,
          'src/export.js',
        ),
      ),
    ).toEqual(['serial'])
  })

  it.each([
    `async function writeRows() { for (const row of rows) await drain(row) }`,
    `async function writeRows() { await Promise.all([first(), second()]) }`,
    `async function other() { await Promise.all(rows.map(drain)) }`,
    `async function writeRows(Promise) { await Promise.all(rows.map(drain)) }`,
    `const Promise = custom; async function writeRows() { Promise.all(rows.map(drain)) }`,
    `async function writeRows() { return rows.map(drain) }`,
    `Promise.all(rows.map(drain))`,
    `const { writeRows } = async () => Promise.all(rows.map(drain))`,
    `export default function () { Promise.all(rows.map(drain)) }`,
    `async function writeRows() { function nested() { Promise.all(rows.map(drain)) } }`,
    `function writeRows() { consume(function nested() { Promise.all(rows.map(drain)) }) }`,
    `function writeRows() { const object = { nested() { Promise.all(rows.map(drain)) } } }`,
    `function writeRows() { const object = { nested: () => Promise.all(rows.map(drain)) } }`,
    `function writeRows() { class Nested { nested() { Promise.all(rows.map(drain)) } } }`,
    `function writeRows() { class Nested { nested = () => Promise.all(rows.map(drain)) } }`,
    `function writeRows() { const object = { [key]() { Promise.all(rows.map(drain)) } } }`,
  ])('allows serial, unrelated and shadowed cases: %s', async (code) => {
    expect(
      messageIds(await lintRule('serial-cursor-drains', code, OPTIONS, 'src/export.js')),
    ).toEqual([])
  })

  it.each([
    `async function writeRows() { await Promise.all(await rows.map(drain)) }`,
    `async function writeRows() { await Promise.all(await (await rows.map(drain))) }`,
    `consume(function writeRows() { Promise.all(rows.map(drain)) })`,
    `const object = { writeRows() { Promise.all(rows.map(drain)) } }`,
    `class Exporter { writeRows() { Promise.all(rows.map(drain)) } }`,
    `const writeRows = function internal() { Promise.all(rows.map(drain)) }`,
    `function writeRows() { consume(() => Promise.all(rows.map(drain))) }`,
  ])('rejects eager drains through wrappers and selected nearest owners: %s', async (code) => {
    expect(
      messageIds(await lintRule('serial-cursor-drains', code, OPTIONS, 'src/export.js')),
    ).toEqual(['serial'])
  })

  it.each([
    'rows?.map(drain) ?? []',
    '[] || rows.map(drain)',
    'enabled ? rows.map(drain) : []',
    'enabled ? [] : rows.map(drain)',
    'rows.map(drain) ? [] : []',
    '[...rows.map(drain)]',
    'rows.map(drain).filter(Boolean)',
    'passThrough(rows.map(drain))',
    'new Collection(rows.map(drain))',
    'rows.map(drain)[method]()',
    'object[rows.map(drain)]()',
    '[first(), rows.map(drain)]',
    '(first(), rows.map(drain))',
  ])('rejects eager drains nested in %s', async (argument) => {
    expect(
      messageIds(
        await lintRule(
          'serial-cursor-drains',
          `function writeRows() { Promise.all(${argument}) }`,
          OPTIONS,
          'src/export.js',
        ),
      ),
    ).toEqual(['serial'])
  })

  it.each([
    'enabled ? [] : []',
    '[] ?? []',
    '[, () => rows.map(drain)]',
    'passThrough(() => rows.map(drain))',
    'new Collection([])',
    'object[method]()',
    '(first(), [])',
    '',
  ])('allows arguments without eagerly evaluated iterations: %s', async (argument) => {
    expect(
      messageIds(
        await lintRule(
          'serial-cursor-drains',
          `function writeRows() { Promise.all(${argument}) }`,
          OPTIONS,
          'src/export.js',
        ),
      ),
    ).toEqual([])
  })

  it('keeps selected methods, owners and files configurable', async () => {
    const code = `function writeRows() { Promise.all(rows.map(drain)) }`
    expect(messageIds(await lintRule('serial-cursor-drains', code, OPTIONS))).toEqual([])
    expect(
      messageIds(
        await lintRule(
          'serial-cursor-drains',
          code,
          { ...OPTIONS, promiseMethods: ['race'] },
          'src/export.js',
        ),
      ),
    ).toEqual([])
    expect(
      messageIds(
        await lintRule(
          'serial-cursor-drains',
          code,
          { ...OPTIONS, iterationMethods: ['forEach'] },
          'src/export.js',
        ),
      ),
    ).toEqual([])
    expect(messageIds(await lintRule('serial-cursor-drains', code, null, 'src/export.js'))).toEqual(
      [],
    )
    expect(resolveSerialDrainOptions({ functions: [] })).toBeNull()
    expect(resolveSerialDrainOptions({ functions: ['x'], exclude: 1 })).toBeNull()
  })
})
