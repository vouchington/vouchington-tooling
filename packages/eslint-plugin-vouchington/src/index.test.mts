import { describe, expect, it } from 'vitest'
import plugin, { createPlugin, PLUGIN_NAME, RULE_ROUTING } from './index.mts'

describe('eslint-plugin-vouchington', () => {
  it('exports routing documentation and the postgres cursor rule', () => {
    expect(plugin.meta.name).toBe(PLUGIN_NAME)
    expect(plugin.meta.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(Object.keys(plugin.rules)).toEqual(['postgres-cursor-call-contract'])
    expect(plugin.rules['postgres-cursor-call-contract']).toEqual(
      expect.objectContaining({ create: expect.any(Function) }),
    )
    expect(RULE_ROUTING).toEqual([
      'Generic rules belong in eslint-plugin-no-mistakes.',
      'Vouchington convention rules with no product nouns belong here.',
      'Single-repo product coupling stays in the product monorepo.',
    ])
  })

  it('accepts an explicit version for tests and consumers', () => {
    expect(createPlugin('1.2.3').meta).toEqual({ name: PLUGIN_NAME, version: '1.2.3' })
  })
})
