import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SharedContext } from '../shared-context/index.mts'
import { findExpectations } from './manifest-version-parser.mts'
import { buildDependencyMatchers, SEMVER_LITERAL } from './manifest-version-patterns.mts'

const TEST_SOURCE_FILE = /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/u
const PACKAGE_JSON_FILE = /(?:^|\/)package\.json$/u
const TEST_OR_FIXTURE_DIRECTORY =
  /(?:^|\/)(?:test|tests|__tests__|fixture|fixtures|__fixtures__)(?:\/|$)/u
const DEPENDENCY_FIELD =
  /\b(?:dependencies|devDependencies|optionalDependencies|peerDependencies)\b/u
const STRING_LITERAL =
  /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\$]*(?:\\.[^`\\$]*)*)`/gu

function readTrackedSource(ctx: SharedContext, file: string): string | null {
  try {
    return ctx.readTrackedFile
      ? ctx.readTrackedFile(file)
      : readFileSync(join(ctx.repoRoot, file), 'utf8')
  } catch {
    return null
  }
}
function dependencyNames(ctx: SharedContext): Set<string> {
  const names = new Set<string>()
  for (const file of ctx.trackedFiles) {
    if (!PACKAGE_JSON_FILE.test(file) || TEST_OR_FIXTURE_DIRECTORY.test(file)) continue
    const source = readTrackedSource(ctx, file)
    if (source === null) continue
    let manifest: unknown
    try {
      manifest = JSON.parse(source)
    } catch {
      continue
    }
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) continue
    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      const dependencies = (manifest as Record<string, unknown>)[field]
      if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies))
        continue
      for (const name of Object.keys(dependencies)) names.add(name)
    }
  }
  return names
}
function literalValues(source: string): string[] {
  return [...source.matchAll(STRING_LITERAL)].map(
    (match) => (match[1] ?? match[2] ?? match[3]) as string,
  )
}
function expectedDependencyNames(values: readonly string[], names: ReadonlySet<string>): string[] {
  return values.some((value) => SEMVER_LITERAL.test(value))
    ? values.filter((value) => names.has(value))
    : []
}
/** Keeps Dependabot updates independent from literal dependency-version test assertions. */
export function checkManifestDependencyVersionAssertions(
  ctx: SharedContext,
  errors: string[],
): void {
  const names = dependencyNames(ctx)
  if (names.size === 0) return
  const matchers = buildDependencyMatchers(names)
  for (const file of ctx.trackedFiles) {
    if (!TEST_SOURCE_FILE.test(file)) continue
    const source = readTrackedSource(ctx, file)
    if (source === null) {
      errors.push(
        `::error file=${file}::${file}: failed to read test source for manifest dependency version assertions`,
      )
      continue
    }
    for (const expectation of findExpectations(source)) {
      const asserted = new Set<string>()
      if (DEPENDENCY_FIELD.test(expectation.expression)) {
        const values = literalValues(expectation.expected)
        if (values.length === 1 && SEMVER_LITERAL.test(values[0]!)) {
          for (const matcher of matchers)
            if (matcher.member.test(expectation.expression)) asserted.add(matcher.name)
        }
        for (const name of expectedDependencyNames(values, names)) asserted.add(name)
        for (const matcher of matchers)
          if (matcher.objectValue.test(expectation.expected)) asserted.add(matcher.name)
      }
      for (const value of literalValues(expectation.expected)) {
        for (const matcher of matchers)
          if (matcher.packageSpec.test(value)) asserted.add(matcher.name)
      }
      for (const name of asserted) {
        const line = source.slice(0, expectation.index).split('\n').length
        errors.push(
          `::error file=${file},line=${line}::${file}:${line}: tests must not assert the exact version of declared dependency "${name}"; assert dependency membership or derive the value from the manifest instead`,
        )
      }
    }
  }
}
