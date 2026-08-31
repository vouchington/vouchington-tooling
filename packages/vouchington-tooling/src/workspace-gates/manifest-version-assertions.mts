import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SharedContext } from '../shared-context/index.mts'

const TEST_SOURCE_FILE = /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/u
const PACKAGE_JSON_FILE = /(?:^|\/)package\.json$/u
const TEST_OR_FIXTURE_DIRECTORY =
  /(?:^|\/)(?:test|tests|__tests__|fixture|fixtures|__fixtures__)(?:\/|$)/u
const DEPENDENCY_FIELD =
  /\b(?:dependencies|devDependencies|optionalDependencies|peerDependencies)\b/u
const EXPECTATION_MATCHER =
  /^(?:\?\.)?\.\s*(?:not\s*\.\s*)?to(?:Be|Equal|StrictEqual|MatchObject|Contain|ContainEqual)\s*\(/u
const SEMVER_LITERAL = /^[~^<>=*v\s]*\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/u
const STRING_LITERAL =
  /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\$]*(?:\\.[^`\\$]*)*)`/gu

type Expectation = { expression: string; expected: string; index: number }
function readTrackedSource(ctx: SharedContext, file: string): string | null {
  try {
    return ctx.readTrackedFile
      ? ctx.readTrackedFile(file)
      : readFileSync(join(ctx.repoRoot, file), 'utf8')
  } catch {
    return null
  }
}
function skipStringOrComment(source: string, index: number): number {
  const marker = source[index]
  if (marker === '/' && source[index + 1] === '/') {
    const end = source.indexOf('\n', index + 2)
    return end === -1 ? source.length : end
  }
  if (marker === '/' && source[index + 1] === '*') {
    const end = source.indexOf('*/', index + 2)
    return end === -1 ? source.length : end + 2
  }
  if (marker !== "'" && marker !== '"' && marker !== '`') return index
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1
      continue
    }
    if (source[cursor] === marker) return cursor + 1
  }
  return source.length
}
function closingParenthesis(source: string, open: number): number {
  let depth = 1
  for (let cursor = open + 1; cursor < source.length; cursor += 1) {
    const skipped = skipStringOrComment(source, cursor)
    if (skipped !== cursor) {
      cursor = skipped - 1
      continue
    }
    if (source[cursor] === '(') depth += 1
    if (source[cursor] === ')') depth -= 1
    if (depth === 0) return cursor
  }
  return -1
}
function expectations(source: string): Expectation[] {
  const found: Expectation[] = []
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const skipped = skipStringOrComment(source, cursor)
    if (skipped !== cursor) {
      cursor = skipped - 1
      continue
    }
    if (!source.startsWith('expect', cursor) || /[\w$]/u.test(source[cursor - 1] ?? '')) continue
    let open = cursor + 'expect'.length
    while (/\s/u.test(source[open] ?? '')) open += 1
    if (source[open] !== '(') continue
    const expressionEnd = closingParenthesis(source, open)
    if (expressionEnd === -1) continue
    const matcher = source.slice(expressionEnd + 1).match(EXPECTATION_MATCHER)
    if (!matcher) continue
    const expectedOpen = expressionEnd + 1 + matcher[0].length - 1
    const expectedEnd = closingParenthesis(source, expectedOpen)
    if (expectedEnd === -1) continue
    found.push({
      expression: source.slice(open + 1, expressionEnd),
      expected: source.slice(expectedOpen + 1, expectedEnd),
      index: cursor,
    })
    cursor = expectedEnd
  }
  return found
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
  return [...source.matchAll(STRING_LITERAL)].map((match) => match[1] ?? match[2] ?? match[3] ?? '')
}
function expectedDependencyNames(values: readonly string[], names: ReadonlySet<string>): string[] {
  return values.some((value) => SEMVER_LITERAL.test(value))
    ? values.filter((value) => names.has(value))
    : []
}
function indexedDependencyNames(expression: string, names: ReadonlySet<string>): string[] {
  const found = new Set<string>()
  for (const name of names) {
    const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const member = /^[A-Za-z_$][\w$]*$/u.test(name)
      ? `(?:\\[\\s*['"]${escaped}['"]\\s*\\]|\\.\\s*${escaped})`
      : `\\[\\s*['"]${escaped}['"]\\s*\\]`
    if (new RegExp(member, 'u').test(expression)) found.add(name)
  }
  return [...found]
}

function objectVersionNames(expected: string, names: ReadonlySet<string>): string[] {
  const found = new Set<string>()
  for (const name of names) {
    const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const key = /^[A-Za-z_$][\w$]*$/u.test(name)
      ? `(?:${escaped}|['"]${escaped}['"])`
      : `['"]${escaped}['"]`
    const matcher = new RegExp(
      `${key}\\s*:\\s*(['"])([~^<>=*v\\s]*\\d+\\.\\d+(?:\\.\\d+)?(?:[-+][0-9A-Za-z.-]+)?)\\1`,
      'u',
    )
    if (matcher.test(expected)) found.add(name)
  }
  return [...found]
}

/** Keeps Dependabot updates independent from literal dependency-version test assertions. */
export function checkManifestDependencyVersionAssertions(
  ctx: SharedContext,
  errors: string[],
): void {
  const names = dependencyNames(ctx)
  if (names.size === 0) return
  for (const file of ctx.trackedFiles) {
    if (!TEST_SOURCE_FILE.test(file)) continue
    const source = readTrackedSource(ctx, file)
    if (source === null) {
      errors.push(
        `::error file=${file}::${file}: failed to read test source for manifest dependency version assertions`,
      )
      continue
    }
    for (const expectation of expectations(source)) {
      const asserted = new Set<string>()
      if (DEPENDENCY_FIELD.test(expectation.expression)) {
        const values = literalValues(expectation.expected)
        if (values.length === 1 && SEMVER_LITERAL.test(values[0] ?? '')) {
          for (const name of indexedDependencyNames(expectation.expression, names))
            asserted.add(name)
        }
        for (const name of expectedDependencyNames(values, names)) asserted.add(name)
        for (const name of objectVersionNames(expectation.expected, names)) asserted.add(name)
      }
      for (const value of literalValues(expectation.expected)) {
        for (const name of names) {
          const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
          if (
            new RegExp(
              `^${escaped}@[~^<>=*v\\s]*\\d+\\.\\d+(?:\\.\\d+)?(?:[-+][0-9A-Za-z.-]+)?$`,
              'u',
            ).test(value)
          )
            asserted.add(name)
        }
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
