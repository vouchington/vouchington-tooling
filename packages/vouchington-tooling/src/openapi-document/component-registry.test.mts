import { describe, expect, it } from 'vitest'

import { createComponentRegistry, sanitizeComponentName } from './component-registry.mts'
import { objectNode as obj, requiredProperty as prop } from './schema-node-builders.mts'

describe('sanitizeComponentName', () => {
  it('leaves simple identifiers unchanged', () => {
    expect(sanitizeComponentName('Widget')).toBe('Widget')
  })

  it('maps generic angle brackets and comma separators to underscores', () => {
    expect(sanitizeComponentName('Paginated<Widget>')).toBe('Paginated_Widget')
    expect(sanitizeComponentName('Record<string,WidgetSummary>')).toBe(
      'Record_string_WidgetSummary',
    )
  })

  it('replaces any other invalid component-key character', () => {
    expect(sanitizeComponentName('Weird Name!')).toBe('Weird_Name_')
  })
})

describe('createComponentRegistry', () => {
  it('sanitizes a raw name once and returns the same key on repeat lookups', () => {
    const registry = createComponentRegistry()
    expect(registry.refName('Paginated<Widget>')).toBe('Paginated_Widget')
    expect(registry.refName('Paginated<Widget>')).toBe('Paginated_Widget')
  })

  it('registers definitions and exposes them sorted by sanitized name', () => {
    const registry = createComponentRegistry()
    registry.register('routeA', {
      Widget: obj({ id: prop({ type: 'string' }) }),
      Author: obj({ name: prop({ type: 'string' }) }),
    })
    expect(registry.schemas()).toEqual({
      Author: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
      Widget: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    })
  })

  it('dedups identical definitions registered from different contracts', () => {
    const registry = createComponentRegistry()
    const post = obj({ id: prop({ type: 'string' }) })
    registry.register('routeA', { Widget: post, Comment: obj({ body: prop({ type: 'string' }) }) })
    // Widget is re-registered with the exact same node but different sibling definitions — this
    // must not false-positive as a collision purely from the surrounding map differing.
    registry.register('routeB', { Widget: post, Tag: obj({ name: prop({ type: 'string' }) }) })
    expect(Object.keys(registry.schemas())).toEqual(['Comment', 'Tag', 'Widget'])
  })

  it('throws when the same sanitized name maps to conflicting shapes across contracts', () => {
    const registry = createComponentRegistry()
    registry.register('routeA', { Widget: obj({ id: prop({ type: 'string' }) }) })
    expect(() =>
      registry.register('routeB', { Widget: obj({ id: prop({ type: 'number' }) }) }),
    ).toThrow('OpenAPI component "Widget" (raw name "Widget") maps to conflicting shapes')
  })

  it('throws when two raw names within the same register() call sanitize to the same key with conflicting shapes', () => {
    const registry = createComponentRegistry()
    // `Foo<Bar,Baz>` and `Foo<Bar_Baz>` both sanitize to `Foo_Bar_Baz` — this must be caught even
    // though neither name is in `entries` yet when the second one is checked (both are still
    // pending within this same batch).
    expect(() =>
      registry.register('routeA', {
        'Foo<Bar,Baz>': obj({ id: prop({ type: 'string' }) }),
        'Foo<Bar_Baz>': obj({ id: prop({ type: 'number' }) }),
      }),
    ).toThrow('OpenAPI component "Foo_Bar_Baz"')
  })

  it('renders nested refs through the shared refName, consistent across contracts', () => {
    const registry = createComponentRegistry()
    registry.register('routeA', {
      Widget: { type: 'ref', name: 'Author' },
      Author: obj({ name: prop({ type: 'string' }) }),
    })
    registry.register('routeB', { Author: obj({ name: prop({ type: 'string' }) }) })
    expect(registry.schemas().Widget).toEqual({ $ref: '#/components/schemas/Author' })
  })
})
