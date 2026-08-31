import { describe, expect, it } from 'vitest'

import {
  buildDependencyMatchers,
  SEMVER_LITERAL,
  SEMVER_SOURCE,
} from './manifest-version-patterns.mts'

describe('manifest-version patterns', () => {
  it('builds reusable matchers for ordinary, scoped, and punctuation-bearing dependencies', () => {
    const [plain, scoped, punctuated] = buildDependencyMatchers(
      new Set(['plain', '@scope/example', 'example.js']),
    )

    expect(SEMVER_LITERAL.test('^1.2.3')).toBe(true)
    expect(SEMVER_LITERAL.test('workspace:*')).toBe(false)
    expect(SEMVER_SOURCE).toContain('\\d+')
    expect(plain).toMatchObject({ name: 'plain' })
    expect(plain?.member.test('manifest.dependencies.plain')).toBe(true)
    expect(scoped?.member.test("manifest.dependencies['@scope/example']")).toBe(true)
    expect(punctuated?.member.test("manifest.dependencies['example.js']")).toBe(true)
    expect(plain?.objectValue.test("plain: '^1.2.3'")).toBe(true)
    expect(scoped?.objectValue.test("'@scope/example': '~1.2.3'")).toBe(true)
    expect(punctuated?.packageSpec.test('example.js@1.2.3')).toBe(true)
  })
})
