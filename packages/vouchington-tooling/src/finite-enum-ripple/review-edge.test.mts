import { expect, it } from 'vitest'
import { parseUnionRouteConfigEntries, parseUnionTypeUnion } from './parsers.mts'
import { collectActivePatternCaptures } from './pattern-captures.mts'
import { collectCreatePageLiterals } from './create-page-literals.mts'
import { checkUnionCreatePageTypes } from './compare.mts'

const file = 'fixture/routes.ts'

it('keeps executable backtick route literals while ignoring embedded examples', () => {
  const source = 'const example = "path: `/old`"; const route = { path: `/right` }'
  expect(collectActivePatternCaptures(source, /[`]\/([^`]*)[`]/g, file)).toEqual(['right'])
})

it('accepts an empty string constituent in a finite union', () => {
  expect(parseUnionTypeUnion("type Kind = '' | 'entry'", file, 'Kind')).toEqual(['', 'entry'])
})

it('rejects route members that cannot be fully inspected', () => {
  const parse = (source: string) =>
    parseUnionRouteConfigEntries(source, file, 'routes', 'kinds', 'plural', 'singular')
  const valid = "entries: { kinds: ['entry'], plural: 'entries', singular: 'entry' }"
  expect(() => parse(`const routes = { ${valid}, ...extra }`)).toThrow('uninspectable route member')
  expect(() => parse(`const routes = { ${valid}, shorthand }`)).toThrow(
    'uninspectable route member',
  )
  expect(() => parse(`const routes = { ${valid}, [dynamic]: {} }`)).toThrow(
    'uninspectable route key',
  )
  expect(() => parse(`const routes = { ${valid}, other: createRoute() }`)).toThrow(
    'must be an object literal',
  )
  expect(() => parse('const routes = {}')).toThrow('could not parse routes entries')
})

it('collects literal element-access assignments but not dynamic property names', () => {
  expect(
    collectCreatePageLiterals(
      "form['action'] = 'other'; form[key] = 'ignored'; form['action'] = dynamic; ({ other } = 'skip')",
      'page.tsx',
      ['action'],
    ),
  ).toEqual(['other'])
})

it('reports a selected create page without a matching single-type route', () => {
  const errors: string[] = []
  checkUnionCreatePageTypes(
    errors,
    [{ pluralPath: 'entries', unionTypes: ['entry'] }],
    [{ file: 'page.tsx', slug: 'drafts', isTopLevel: true }],
    () => "form['action'] = 'entry'",
    ['action'],
    'record',
  )
  expect(errors.join('\n')).toContain('no matching single-type route config for "drafts"')
})
