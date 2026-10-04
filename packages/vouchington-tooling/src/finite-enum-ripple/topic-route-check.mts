import type { FiniteEnumFiles, FiniteEnumRippleConfig, ReadTrackedFile } from './model.mts'
import type { TopicTypeEntry } from './parsers.mts'
import { parseTopicRouteConfigEntries } from './parsers.mts'
import {
  checkCollectionPagePathLiterals,
  checkTopicCollectionComponentPathLiterals,
  compareSets,
  finiteEnumError,
  hasAllFiles,
  routePageSlugs,
  uniqueSorted,
} from './compare.mts'

export function checkTopicRouteConfigs(
  errors: string[],
  files: FiniteEnumFiles,
  readTracked: ReadTrackedFile,
  config: NonNullable<FiniteEnumRippleConfig['topic']>,
  backendEntries: TopicTypeEntry[],
  backendSlugByValue: Map<string, string>,
): void {
  const routeConfigsPath = config.routeConfigsPath
  const backendTopicsPath = config.backendPath
  if (hasAllFiles(files, [routeConfigsPath])) {
    const routeConfigContent = readTracked(routeConfigsPath)
    if (routeConfigContent.includes(config.routeConfigObject)) {
      const routeConfigs = parseTopicRouteConfigEntries(
        routeConfigContent,
        routeConfigsPath,
        config.routeConfigObject,
        config.typeArrayProperty,
        config.spendingCategoryProperty,
        config.pluralPathProperty,
        config.singularPathProperty,
      )
      const slugPluralByValue = new Map(
        backendEntries.map((entry) => [entry.value, entry.slugPlural]),
      )
      const valueBySlug = new Map(backendEntries.map((entry) => [entry.slug, entry.value]))
      const typedRouteConfigs = routeConfigs.map((routeConfig) => ({
        ...routeConfig,
        inferredTopicType: valueBySlug.get(routeConfig.singularPath),
      }))
      for (const routeConfig of typedRouteConfigs) {
        if (
          routeConfig.topicTypes.length > 0 ||
          routeConfig.spendingCategory ||
          !routeConfig.inferredTopicType ||
          config.routeConfigExceptions.includes(routeConfig.key)
        ) {
          continue
        }
        errors.push(
          finiteEnumError(
            routeConfigsPath,
            `${config.routeConfigObject}.${routeConfig.key} has ${config.singularPathProperty} "${routeConfig.singularPath}" but does not declare ${config.typeArrayProperty}`,
          ),
        )
      }
      const enumRouteConfigs = typedRouteConfigs.filter(
        (routeConfig) => routeConfig.topicTypes.length > 0,
      )
      for (const routeConfig of routeConfigs) {
        if (routeConfig.key === routeConfig.pluralPath) continue
        errors.push(
          finiteEnumError(
            routeConfigsPath,
            `${config.routeConfigObject}.${routeConfig.key} has ${config.pluralPathProperty} "${routeConfig.pluralPath}" but the route config key is "${routeConfig.key}"`,
          ),
        )
      }
      for (const routeConfig of enumRouteConfigs) {
        const topicType = routeConfig.topicTypes[0]
        const expectedSlug = topicType ? backendSlugByValue.get(topicType) : undefined
        const expectedSlugPlural = topicType ? slugPluralByValue.get(topicType) : undefined
        if (
          routeConfig.topicTypes.length === 1 &&
          routeConfig.singularPath === expectedSlug &&
          routeConfig.pluralPath === expectedSlugPlural
        ) {
          continue
        }
        errors.push(
          finiteEnumError(
            routeConfigsPath,
            `${config.routeConfigObject}.${routeConfig.key} maps ${config.singularPathProperty} "${routeConfig.singularPath}" and ${config.pluralPathProperty} "${routeConfig.pluralPath}" to [${routeConfig.topicTypes.join(', ')}] but ${config.typeObject} expects "${expectedSlug ?? 'missing'}" and "${expectedSlugPlural ?? 'missing'}"`,
          ),
        )
      }
      compareSets(errors, {
        label: `${config.collectionLabel} route config values`,
        actualLabel: `${routeConfigsPath} ${config.routeConfigObject}`,
        actualValues: enumRouteConfigs.flatMap((routeConfig) => routeConfig.topicTypes),
        expectedLabel: backendTopicsPath,
        expectedValues: enumRouteConfigs.flatMap((routeConfig) =>
          routeConfig.topicTypes.filter((value) => slugPluralByValue.has(value)),
        ),
      })
      compareSets(errors, {
        label: `${config.collectionLabel} collection route config paths`,
        actualLabel: `${routeConfigsPath} ${config.routeConfigObject}`,
        actualValues: enumRouteConfigs.map((routeConfig) => routeConfig.pluralPath),
        expectedLabel: `${backendTopicsPath} ${config.typeObject} ${config.slugPluralProperty}`,
        expectedValues: enumRouteConfigs.flatMap((routeConfig) => {
          const slugPlural = routeConfig.topicTypes[0]
            ? slugPluralByValue.get(routeConfig.topicTypes[0])
            : undefined
          return slugPlural ? [slugPlural] : []
        }),
      })
      compareSets(errors, {
        label: `${config.collectionLabel} top-level collection route directories`,
        actualLabel: config.routeLabels.collectionTop,
        actualValues: routePageSlugs(files.topicCollectionPages, true),
        expectedLabel: `${routeConfigsPath} ${config.routeConfigObject} ${config.pluralPathProperty}`,
        expectedValues: routeConfigs.map((routeConfig) => routeConfig.pluralPath),
      })
      compareSets(errors, {
        label: `${config.collectionLabel} collection routed pages`,
        actualLabel: config.routeLabels.collection,
        actualValues: uniqueSorted(files.topicCollectionPages.map((page) => page.slug)),
        expectedLabel: `${routeConfigsPath} ${config.routeConfigObject} ${config.pluralPathProperty}`,
        expectedValues: routeConfigs.map((routeConfig) => routeConfig.pluralPath),
      })
      checkCollectionPagePathLiterals(
        files.topicCollectionPages,
        errors,
        config.collectionLabel,
        new Set(routeConfigs.map((routeConfig) => routeConfig.pluralPath)),
        readTracked,
        config.collectionPathLiteralPattern,
      )
      checkTopicCollectionComponentPathLiterals(
        errors,
        routeConfigs,
        files.topicComponentFiles,
        new Set(config.ignoredNavigationPaths),
        readTracked,
        config.collectionLabel,
        config.navigationPathLiteralPattern,
      )
    }
  }
}
