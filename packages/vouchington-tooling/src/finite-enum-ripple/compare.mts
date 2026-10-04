import type { FiniteEnumFiles, ReadTrackedFile, RoutedPage } from './model.mts'
import { collectCreatePageLiterals } from './create-page-literals.mts'
import { collectActivePatternCaptures } from './pattern-captures.mts'

export function hasAllFiles(files: FiniteEnumFiles, paths: readonly string[]): boolean {
  return paths.every((file) => files.existingFileSet.has(file))
}

export function checkUnionCreatePageTypes(
  errors: string[],
  routeConfigs: { pluralPath: string; unionTypes: string[] }[],
  pages: readonly RoutedPage[],
  readTracked: ReadTrackedFile,
  createPageTypeProperties: readonly string[],
  label: string,
): void {
  const typeByPluralPath = new Map(
    routeConfigs.flatMap((config) =>
      config.unionTypes.length === 1 ? [[config.pluralPath, config.unionTypes[0]] as const] : [],
    ),
  )
  for (const page of pages) {
    const expectedType = typeByPluralPath.get(page.slug)
    if (expectedType === undefined) {
      errors.push(
        finiteEnumError(
          page.file,
          `${label} create page has no matching single-type route config for "${page.slug}"`,
        ),
      )
      continue
    }
    const content = readTracked(page.file)
    const actualTypes = collectCreatePageLiterals(content, page.file, createPageTypeProperties)
    if (actualTypes.length === 0)
      errors.push(
        finiteEnumError(page.file, `${label} create page has no inspectable type literal`),
      )
    for (const actualType of actualTypes) {
      if (actualType === expectedType) continue
      errors.push(
        finiteEnumError(
          page.file,
          `${label} create page literal uses "${actualType}" but ${page.slug} expects "${expectedType}"`,
        ),
      )
    }
  }
}

export function checkCollectionPagePathLiterals(
  pages: readonly RoutedPage[],
  errors: string[],
  group: string,
  routeSlugs: ReadonlySet<string>,
  readTracked: ReadTrackedFile,
  pathPattern: RegExp,
): void {
  for (const page of pages) {
    if (!routeSlugs.has(page.slug)) continue
    const content = readTracked(page.file)
    for (const literalPath of collectActivePatternCaptures(content, pathPattern, page.file)) {
      if (literalPath === page.slug || literalPath.startsWith(`${page.slug}/`)) continue
      errors.push(
        finiteEnumError(
          page.file,
          `${group} collection path literal "/${literalPath}" does not match route directory "${page.slug}"`,
        ),
      )
    }
  }
}

export function compareSets(
  errors: string[],
  options: {
    label: string
    actualLabel: string
    actualFile: string
    actualValues: readonly string[]
    expectedLabel: string
    expectedFile: string
    expectedValues: readonly string[]
  },
): void {
  for (const duplicate of duplicateValues(options.actualValues)) {
    errors.push(
      finiteEnumError(
        options.actualFile,
        `${options.label} duplicate in actual values: ${duplicate}`,
      ),
    )
  }
  for (const duplicate of duplicateValues(options.expectedValues)) {
    errors.push(
      finiteEnumError(
        options.expectedFile,
        `${options.label} duplicate in expected values: ${duplicate}`,
      ),
    )
  }

  const actual = uniqueSorted(options.actualValues)
  const expected = uniqueSorted(options.expectedValues)
  const missing = expected.filter((value) => !actual.includes(value))
  const extra = actual.filter((value) => !expected.includes(value))
  if (missing.length === 0 && extra.length === 0) return

  const parts = [
    `${options.label} mismatch`,
    missing.length > 0 ? `missing from ${options.actualLabel}: ${missing.join(', ')}` : '',
    extra.length > 0 ? `stale in ${options.actualLabel}: ${extra.join(', ')}` : '',
    `expected from ${options.expectedLabel}: ${expected.join(', ')}`,
  ].filter(Boolean)
  errors.push(finiteEnumError(options.actualFile, parts.join('; ')))
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted()
}

export function routePageSlugs(pages: readonly RoutedPage[], topOnly = false): string[] {
  const slugs = new Set<string>()
  for (const page of pages) {
    if (!topOnly || page.isTopLevel) slugs.add(page.slug)
  }
  return [...slugs].toSorted()
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates].toSorted()
}

export function finiteEnumError(file: string, message: string): string {
  const escapeProperty = (value: string) =>
    value
      .replaceAll('%', '%25')
      .replaceAll('\r', '%0D')
      .replaceAll('\n', '%0A')
      .replaceAll(':', '%3A')
      .replaceAll(',', '%2C')
  return `::error file=${escapeProperty(file)}::${escapeWorkflowData(`${file}: ${message}.`)}`
}

export function escapeWorkflowData(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}
