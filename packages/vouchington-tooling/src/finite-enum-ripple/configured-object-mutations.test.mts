import { describe, expect, it } from 'vitest'
import { parseUnionRouteConfigEntries } from './parsers.mts'

const file = 'src/routes.ts'

describe('configured object mutations', () => {
  it('rejects destructuring writes rooted at the configured symbol', () => {
    for (const write of [
      '({ value: routes.entries.singular } = source)',
      '[routes.entries.singular] = source',
      '({ ...routes.entries } = source)',
    ]) {
      expect(() =>
        parseUnionRouteConfigEntries(
          `const routes = { entries: { singular: 'entry', plural: 'entries', kinds: ['entry'] } }; ${write}`,
          file,
          'routes',
          'kinds',
          'plural',
          'singular',
        ),
      ).toThrow('post-declaration property mutation')
    }
  })

  it('preserves unrelated and shadowed destructuring targets', () => {
    const unrelated =
      "const routes = { entries: { singular: 'entry', plural: 'entries', kinds: ['entry'] } }; ({ value: other.singular } = source)"
    expect(
      parseUnionRouteConfigEntries(unrelated, file, 'routes', 'kinds', 'plural', 'singular'),
    ).toHaveLength(1)
    const shadowed =
      "const routes = { entries: { singular: 'entry', plural: 'entries', kinds: ['entry'] } }; function update() { const routes = { entries: { singular: 'other' } }; ({ value: routes.entries.singular } = source) }"
    expect(
      parseUnionRouteConfigEntries(shadowed, file, 'routes', 'kinds', 'plural', 'singular'),
    ).toHaveLength(1)
  })
})
