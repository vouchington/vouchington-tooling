import { expect, it } from 'vitest'
import { compareSets } from './compare.mts'
import { collectCreatePageLiterals } from './create-page-literals.mts'

it('blames a real source file for expected duplicates', () => {
  const errors: string[] = []
  compareSets(errors, {
    label: 'kind values',
    actualLabel: 'browser kinds',
    actualFile: 'ui/kinds.ts',
    actualValues: ['alpha'],
    expectedLabel: 'source kinds',
    expectedFile: 'src/kinds.ts',
    expectedValues: ['alpha', 'alpha'],
  })
  expect(errors).toContainEqual(
    expect.stringContaining(
      '::error file=src/kinds.ts::src/kinds.ts: kind values duplicate in expected values: alpha',
    ),
  )
})

it('recognizes active object, JSX, and assignment literals only', () => {
  const values = collectCreatePageLiterals(
    [
      "const fields = { action: 'entry', other: 'skip' }",
      "const view = <Form action='entry' other='skip' type={dynamic} />",
      "action = 'entry'; form.action = 'entry'; form['action'] = 'skip'",
      "// action: 'old'",
      'const example = "action: \'old\'"',
    ].join('\n'),
    'ui/entries/create/page.tsx',
    ['action'],
  )
  expect(values).toEqual(['entry', 'entry', 'entry', 'entry', 'skip'])
})

it('inspects a literal inside a JSX expression attribute', () => {
  expect(
    collectCreatePageLiterals(
      "const view = <Form action={'other'} type={dynamic} />",
      'ui/create/page.tsx',
      ['action'],
    ),
  ).toEqual(['other'])
})

it('preserves an explicitly configured empty property name', () => {
  expect(
    collectCreatePageLiterals(
      "const fields = { '': 'wrong', action: 'entry' }",
      'ui/create/page.tsx',
      ['', 'action'],
    ),
  ).toEqual(['wrong', 'entry'])
})
