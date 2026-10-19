import assert from 'node:assert/strict'
import { describe, expect, it } from 'vitest'
import {
  assertCanonicalRootVitestConfig,
  checkCanonicalRootVitestConfigControls,
  DEFAULT_ROOT_VITEST_CONFIG,
} from './config-file.mts'

describe('assertCanonicalRootVitestConfig', () => {
  it('admits only the configured root filename', () => {
    expect(checkCanonicalRootVitestConfigControls()).toEqual([
      { name: 'canonical', admitted: true },
      { name: 'missing', admitted: false },
      { name: 'alternate', admitted: false },
      { name: 'additional', admitted: false },
    ])
    assert.doesNotThrow(() =>
      assertCanonicalRootVitestConfig(['notes.md', 'vitest.config.js'], 'vitest.config.js'),
    )
    expect(() =>
      assertCanonicalRootVitestConfig(['vitest.config.mts'], 'vitest.config.js'),
    ).toThrow(assert.AssertionError)
    expect(DEFAULT_ROOT_VITEST_CONFIG).toBe('vitest.config.mts')
    expect(checkCanonicalRootVitestConfigControls('vitest.config.js')).toContainEqual({
      name: 'alternate',
      admitted: false,
    })
  })
})
