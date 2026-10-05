import { expect, it } from 'vitest'

import { checkStructuredCollectionComponentPathLiterals } from './component-paths.mts'

it('compares complete nested component paths on segment boundaries', () => {
  const config = [{ pluralPath: 'admin/alphas', singularPath: 'admin/alpha' }]
  const errors: string[] = []
  checkStructuredCollectionComponentPathLiterals(
    errors,
    config,
    [{ file: 'admin/alphas/nav.tsx', slug: 'admin/alphas' }],
    new Set(),
    () => "navigate('/admin/alphas/123')",
    'kind',
    /navigate\('\/([^']+)'\)/g,
  )
  expect(errors).toEqual([])

  checkStructuredCollectionComponentPathLiterals(
    errors,
    config,
    [{ file: 'admin/alphas/nav.tsx', slug: 'admin/alphas' }],
    new Set(),
    () => "navigate('/admin/alphas-extra/123')",
    'kind',
    /navigate\('\/([^']+)'\)/g,
  )
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('navigation path "/admin/alphas-extra/123" does not match')
})
