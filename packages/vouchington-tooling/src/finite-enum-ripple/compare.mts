import type { FiniteEnumFiles, ReadTrackedFile, RoutedPage } from './model.mts'

export function hasAllFiles(files: FiniteEnumFiles, paths: readonly string[]): boolean {
  return paths.every((file) => files.existingFileSet.has(file))
}

export function checkPostCreatePageTypes(
  errors: string[],
  routeConfigs: { pluralPath: string; postTypes: string[] }[],
  pages: readonly RoutedPage[],
  readTracked: ReadTrackedFile,
  createPageTypeProperties: readonly string[],
  label: string,
): void {
  const typeByPluralPath = new Map(
    routeConfigs.flatMap((config) =>
      config.postTypes.length === 1 ? [[config.pluralPath, config.postTypes[0]] as const] : [],
    ),
  )
  for (const page of pages) {
    const expectedType = typeByPluralPath.get(page.slug)
    if (!expectedType) continue
    const content = readTracked(page.file)
    for (const actualType of collectPostCreateTypeLiterals(content, createPageTypeProperties)) {
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

function collectPostCreateTypeLiterals(content: string, properties: readonly string[]): string[] {
  return properties.flatMap((property) => {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return [
      ...content.matchAll(new RegExp(`\\b${escaped}\\s*(?:=|:)\\s*['"]([^'"]+)['"]`, 'g')),
    ].flatMap((item) => (item[1] ? [item[1]] : []))
  })
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
    for (const literalPath of [...content.matchAll(pathPattern)].map((item) => item[1])) {
      if (!literalPath || literalPath === page.slug || literalPath.startsWith(`${page.slug}/`))
        continue
      errors.push(
        finiteEnumError(
          page.file,
          `${group} collection path literal "/${literalPath}" does not match route directory "${page.slug}"`,
        ),
      )
    }
  }
}

export function checkTopicCollectionComponentPathLiterals(
  errors: string[],
  routeConfigs: { pluralPath: string; singularPath: string }[],
  componentFiles: readonly { file: string; slug: string }[],
  ignoredNavigationPaths: ReadonlySet<string>,
  readTracked: ReadTrackedFile,
  label: string,
  navigationPattern: RegExp,
): void {
  const configByPluralPath = new Map(routeConfigs.map((config) => [config.pluralPath, config]))
  for (const { file, slug } of componentFiles) {
    const config = configByPluralPath.get(slug)
    if (!config) continue
    const content = readTracked(file)
    for (const literalPath of collectNavigationPathLiterals(
      content,
      ignoredNavigationPaths,
      navigationPattern,
    )) {
      const firstSegment = literalPath.split('/')[0]
      if (firstSegment === config.pluralPath || firstSegment === config.singularPath) continue
      errors.push(
        finiteEnumError(
          file,
          `${label} component navigation path "/${literalPath}" does not match route config "${config.singularPath}" or "${config.pluralPath}"`,
        ),
      )
    }
  }
}

function collectNavigationPathLiterals(
  content: string,
  ignoredPaths: ReadonlySet<string>,
  pattern: RegExp,
): string[] {
  const paths: string[] = []
  for (const match of content.matchAll(pattern)) {
    const literalPath = match[1]
    if (literalPath && !ignoredPaths.has(literalPath)) paths.push(literalPath)
  }
  return paths
}

export function compareSets(
  errors: string[],
  options: {
    label: string
    actualLabel: string
    actualValues: readonly string[]
    expectedLabel: string
    expectedValues: readonly string[]
  },
): void {
  for (const duplicate of duplicateValues(options.actualValues)) {
    errors.push(
      finiteEnumError(
        options.actualLabel,
        `${options.label} duplicate in actual values: ${duplicate}`,
      ),
    )
  }
  for (const duplicate of duplicateValues(options.expectedValues)) {
    errors.push(
      finiteEnumError(
        options.expectedLabel,
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
  errors.push(finiteEnumError(options.actualLabel, parts.join('; ')))
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
  return `::error file=${file}::${file}: ${message}.`
}
