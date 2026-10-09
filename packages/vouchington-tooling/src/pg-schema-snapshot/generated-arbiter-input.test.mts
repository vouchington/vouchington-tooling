import { describe, expect, it } from 'vitest'
import { parsePostgresSql } from 'no-mistakes'
import { projectGeneratedArbiterInput } from './generated-arbiter-input.mts'

async function input(target: string, assignment = 'source = source') {
  const facts = await parsePostgresSql({
    sql: `INSERT INTO items(source) VALUES ('x') ON CONFLICT ${target} DO UPDATE SET ${assignment}`,
  })
  expect(facts.diagnostics).toEqual([])
  const statement = facts.statements[0]
  if (statement?.kind !== 'insert' || !statement.insert.onConflict)
    throw new Error('Missing insert')
  return {
    conflict: statement.insert.onConflict,
    projected: projectGeneratedArbiterInput(statement.insert.onConflict),
  }
}

describe('projectGeneratedArbiterInput', () => {
  it('projects normalized key identities and nested partial predicate columns', async () => {
    const { projected } = await input(
      '(UP, "MixedCase") WHERE lower(label) = coalesce(other, \'x\')',
    )
    expect(projected.complete).toBe(true)
    expect(projected.keyColumns).toEqual(new Set(['up', 'MixedCase']))
    expect(projected.predicateColumns).toEqual(new Set(['label', 'other']))
  })

  it.each([
    ['((lower(label)))', ['label']],
    ['((source || source))', ['source']],
    ['((source || other))', undefined],
    ['((lower(EXCLUDED.source)))', undefined],
    ['((1))', undefined],
    ['ON CONSTRAINT item_key', undefined],
  ])('resolves expression key %s conservatively', async (target, keys) => {
    const { projected } = await input(target)
    expect(projected.complete).toBe(true)
    expect(projected.keyColumns).toEqual(keys === undefined ? undefined : new Set(keys))
  })

  it.each([
    ['source = source', 'source', false],
    ['source = items.source', 'source', false],
    ['source = (source)', 'source', false],
    ['source = (items.source)', 'source', false],
    ['source = EXCLUDED.source', undefined, false],
    ['source = source::text', undefined, false],
    ["source = 'fixed'", undefined, false],
    ['source[1] = source', 'source', true],
    ['source.field = source', 'source', true],
    ['"MixedCase" = "MixedCase"', 'MixedCase', false],
  ])(
    'preserves direct reference and indirection facts for %s',
    async (assignment, reference, indirect) => {
      const { projected } = await input('(key)', assignment)
      expect(projected.complete).toBe(assignment !== 'source = source::text')
      expect(projected.assignments[0]).toMatchObject({
        referencedColumn: reference,
        hasIndirection: indirect,
        complete: assignment !== 'source = source::text',
      })
    },
  )

  it('retains a direct nested parenthesized reference while closing incomplete child facts', async () => {
    const { projected } = await input('(key)', 'source = ((items.source))')
    expect(projected.complete).toBe(false)
    expect(projected.assignments[0]).toMatchObject({
      referencedColumn: 'source',
      hasIndirection: false,
      complete: false,
    })
  })

  it('retains ordered multi-column assignments without treating tuple values as bare references', async () => {
    const { projected } = await input('(key)', '(source, other) = (other, source)')
    expect(projected.assignments.flatMap(({ columns }) => columns)).toEqual(['source', 'other'])
    expect(
      projected.assignments.every(({ referencedColumn }) => referencedColumn === undefined),
    ).toBe(true)
  })

  it('marks missing completeness and incomplete assignment facts closed', async () => {
    const { conflict } = await input('((lower(source)))')
    if (conflict.target.kind !== 'expressions' || conflict.action.kind !== 'doUpdate')
      throw new Error('Missing facts')
    Reflect.deleteProperty(conflict.target.expressions[0]!, 'childrenComplete')
    conflict.action.assignments[0]!.complete = false
    const projected = projectGeneratedArbiterInput(conflict)
    expect(projected.complete).toBe(false)
    expect(projected.keyColumns).toBeUndefined()
    expect(projected.assignments[0]?.complete).toBe(false)
  })

  it('projects DO NOTHING and omitted targets without assigning replay policy', async () => {
    const { conflict } = await input('(key)')
    conflict.target = { kind: 'omitted' }
    conflict.action = { kind: 'doNothing' }
    expect(projectGeneratedArbiterInput(conflict)).toMatchObject({
      action: 'doNothing',
      keyColumns: undefined,
      assignments: [],
      complete: true,
    })
  })
})
