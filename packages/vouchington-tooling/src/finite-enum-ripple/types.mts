import type { FiniteEnumFiles, FiniteEnumRippleConfig, ReadTrackedFile } from './model.mts'
import { parseStructuredRouteFactoryArgs, parseStructuredTypeEntries } from './parsers.mts'
import { compareSets, finiteEnumError, hasAllFiles, routePageSlugs } from './compare.mts'
import { checkStructuredRouteConfigs } from './structured-route-check.mts'

export function checkStructuredTypes(
  errors: string[],
  files: FiniteEnumFiles,
  readTracked: ReadTrackedFile,
  config: NonNullable<FiniteEnumRippleConfig['structured']>,
): void {
  const backendStructuredsPath = config.backendPath
  const webStructuredsPath = config.webPath
  if (!hasAllFiles(files, [backendStructuredsPath, webStructuredsPath])) return

  const backendEntries = parseStructuredTypeEntries(
    readTracked(backendStructuredsPath),
    backendStructuredsPath,
    config.typeObject,
    config.slugProperty,
    config.slugPluralProperty,
  )
  const webEntries = parseStructuredTypeEntries(
    readTracked(webStructuredsPath),
    webStructuredsPath,
    config.typeObject,
    config.slugProperty,
    config.slugPluralProperty,
  )

  const backendSlugByValue = new Map(backendEntries.map((entry) => [entry.value, entry.slug]))
  const backendSlugPluralByValue = new Map(
    backendEntries.map((entry) => [entry.value, entry.slugPlural]),
  )
  compareSets(errors, {
    label: `${config.collectionLabel} values`,
    actualLabel: `${webStructuredsPath} ${config.typeObject}`,
    actualFile: webStructuredsPath,
    actualValues: webEntries.map((entry) => entry.value),
    expectedLabel: `${backendStructuredsPath} ${config.typeObject}`,
    expectedFile: backendStructuredsPath,
    expectedValues: backendEntries.map((entry) => entry.value),
  })
  for (const webEntry of webEntries) {
    const backendSlug = backendSlugByValue.get(webEntry.value)
    if (backendSlug && backendSlug !== webEntry.slug) {
      errors.push(
        finiteEnumError(
          webStructuredsPath,
          `${config.typeObject}.${webEntry.value}.${config.slugProperty} is "${webEntry.slug}" but ${backendStructuredsPath} uses "${backendSlug}"`,
        ),
      )
    }
    const backendSlugPlural = backendSlugPluralByValue.get(webEntry.value)
    if (backendSlugPlural && backendSlugPlural !== webEntry.slugPlural) {
      errors.push(
        finiteEnumError(
          webStructuredsPath,
          `${config.typeObject}.${webEntry.value}.${config.slugPluralProperty} is "${webEntry.slugPlural}" but ${backendStructuredsPath} uses "${backendSlugPlural}"`,
        ),
      )
    }
  }

  const topRouteSlugs = routePageSlugs(files.structuredDetailPages, true)
  const routeSlugs = routePageSlugs(files.structuredDetailPages)
  compareSets(errors, {
    label: `${config.collectionLabel} route directories`,
    actualLabel: config.routeLabels.detailTop,
    actualFile: files.structuredDetailPages[0]?.file ?? backendStructuredsPath,
    actualValues: topRouteSlugs,
    expectedLabel: `${backendStructuredsPath} ${config.typeObject} slugs`,
    expectedFile: backendStructuredsPath,
    expectedValues: backendEntries.map((entry) => entry.slug),
  })
  compareSets(errors, {
    label: `${config.collectionLabel} routed pages`,
    actualLabel: config.routeLabels.detail,
    actualFile: files.structuredDetailPages[0]?.file ?? backendStructuredsPath,
    actualValues: routeSlugs,
    expectedLabel: `${backendStructuredsPath} ${config.typeObject} slugs`,
    expectedFile: backendStructuredsPath,
    expectedValues: backendEntries.map((entry) => entry.slug),
  })

  checkStructuredRouteConfigs(
    errors,
    files,
    readTracked,
    config,
    backendEntries,
    backendSlugByValue,
  )

  for (const page of files.structuredDetailPages) {
    for (const args of parseStructuredRouteFactoryArgs(
      readTracked(page.file),
      page.file,
      config.factoryCallPattern,
    )) {
      if (page.slug === args.slug) continue
      errors.push(
        finiteEnumError(
          page.file,
          `${config.collectionLabel} route factory slug mismatch; route directory is "${page.slug}" but factory uses "${args.slug}"`,
        ),
      )
    }
  }
}
