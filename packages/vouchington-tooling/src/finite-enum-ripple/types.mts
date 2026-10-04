import type { FiniteEnumFiles, FiniteEnumRippleConfig, ReadTrackedFile } from './model.mts'
import { parseTopicRouteFactoryArgs, parseTopicTypeEntries } from './parsers.mts'
import { compareSets, finiteEnumError, hasAllFiles, routePageSlugs } from './compare.mts'
import { checkTopicRouteConfigs } from './topic-route-check.mts'

export function checkTopicTypes(
  errors: string[],
  files: FiniteEnumFiles,
  readTracked: ReadTrackedFile,
  config: NonNullable<FiniteEnumRippleConfig['topic']>,
): void {
  const backendTopicsPath = config.backendPath
  const webTopicsPath = config.webPath
  if (!hasAllFiles(files, [backendTopicsPath, webTopicsPath])) return

  const backendEntries = parseTopicTypeEntries(
    readTracked(backendTopicsPath),
    backendTopicsPath,
    config.typeObject,
    config.slugProperty,
    config.slugPluralProperty,
  )
  const webEntries = parseTopicTypeEntries(
    readTracked(webTopicsPath),
    webTopicsPath,
    config.typeObject,
    config.slugProperty,
    config.slugPluralProperty,
  )

  const backendSlugByValue = new Map(backendEntries.map((entry) => [entry.value, entry.slug]))
  const backendSlugPluralByValue = new Map(
    backendEntries.map((entry) => [entry.value, entry.slugPlural]),
  )
  for (const webEntry of webEntries) {
    const backendSlug = backendSlugByValue.get(webEntry.value)
    if (backendSlug && backendSlug !== webEntry.slug) {
      errors.push(
        finiteEnumError(
          webTopicsPath,
          `${config.typeObject}.${webEntry.value}.${config.slugProperty} is "${webEntry.slug}" but ${backendTopicsPath} uses "${backendSlug}"`,
        ),
      )
    }
    const backendSlugPlural = backendSlugPluralByValue.get(webEntry.value)
    if (backendSlugPlural && backendSlugPlural !== webEntry.slugPlural) {
      errors.push(
        finiteEnumError(
          webTopicsPath,
          `${config.typeObject}.${webEntry.value}.${config.slugPluralProperty} is "${webEntry.slugPlural}" but ${backendTopicsPath} uses "${backendSlugPlural}"`,
        ),
      )
    }
  }

  const topRouteSlugs = routePageSlugs(files.topicDetailPages, true)
  const routeSlugs = routePageSlugs(files.topicDetailPages)
  compareSets(errors, {
    label: `${config.collectionLabel} route directories`,
    actualLabel: config.routeLabels.detailTop,
    actualValues: topRouteSlugs,
    expectedLabel: `${backendTopicsPath} ${config.typeObject} slugs`,
    expectedValues: backendEntries.map((entry) => entry.slug),
  })
  compareSets(errors, {
    label: `${config.collectionLabel} routed pages`,
    actualLabel: config.routeLabels.detail,
    actualValues: routeSlugs,
    expectedLabel: `${backendTopicsPath} ${config.typeObject} slugs`,
    expectedValues: backendEntries.map((entry) => entry.slug),
  })

  checkTopicRouteConfigs(errors, files, readTracked, config, backendEntries, backendSlugByValue)

  for (const page of files.topicDetailPages) {
    for (const args of parseTopicRouteFactoryArgs(
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
