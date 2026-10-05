import { expect, it } from 'vitest'
import { collectActivePatternCaptures } from './pattern-captures.mts'

it('requires a capture from a caller pattern', () => {
  expect(
    collectActivePatternCaptures(
      "path: '/entry'",
      /path:\s*'(?:missing)?'|path:\s*'([^']+)'/g,
      'source.ts',
    ),
  ).toEqual(['/entry'])
  expect(
    collectActivePatternCaptures("path: '/entry'", /path:\s*'([^']+)'?/g, 'source.ts'),
  ).toEqual(['/entry'])
  expect(
    collectActivePatternCaptures("path: '/entry'", /path:\s*'(optional)?/g, 'source.ts'),
  ).toEqual([])
  expect(collectActivePatternCaptures("path: '/'", /path:\s*'\/([^']*)'/g, 'source.ts')).toEqual([
    '',
  ])
  expect(
    collectActivePatternCaptures("path: '/entry'", /path:\s*'\/([^']+)'/, 'source.ts'),
  ).toEqual(['entry'])
  const statefulPattern = /path:\s*'\/([^']+)'/g
  statefulPattern.lastIndex = 10
  expect(collectActivePatternCaptures("path: '/entry'", statefulPattern, 'source.ts')).toEqual([
    'entry',
  ])
  expect(collectActivePatternCaptures("path: '/entry'", statefulPattern, 'source.ts')).toEqual([
    'entry',
  ])
  expect(statefulPattern.lastIndex).toBe(10)
})

it('ignores route-like examples rendered as JSX text', () => {
  const content = "const view = <code>path: '/old'</code>; const route = { path: '/right' }"
  expect(collectActivePatternCaptures(content, /\bpath:\s*['"]\/([^'"]*)/g, 'page.tsx')).toEqual([
    'right',
  ])
})

it('preserves literal-focused route patterns but ignores examples inside string values', () => {
  const content = `const example = "path: '/old'"; const route = { path: '/right' }`
  expect(collectActivePatternCaptures(content, /['"]\/([^'"]*)['"]/g, 'page.tsx')).toEqual([
    'right',
  ])
})
