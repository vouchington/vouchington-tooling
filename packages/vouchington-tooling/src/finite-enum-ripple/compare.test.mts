import { expect, it } from 'vitest'

import { checkUnionCreatePageTypes } from './compare.mts'

it('does not treat a multi-type route as a single-type create-page target', () => {
  const errors: string[] = []
  checkUnionCreatePageTypes(
    errors,
    [{ pluralPath: 'entries', unionTypes: ['entry', 'internal'] }],
    [{ file: 'entries/create.tsx', slug: 'entries', isTopLevel: false }],
    () => '<Form action="entry" />',
    ['action'],
    'record',
  )
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('no matching single-type route config for "entries"')
})
