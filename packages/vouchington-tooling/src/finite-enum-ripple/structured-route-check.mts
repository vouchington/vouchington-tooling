import type { FiniteEnumFiles, FiniteEnumRippleConfig, ReadTrackedFile } from './model.mts'
import type { StructuredTypeEntry } from './parsers.mts'
import { hasConstObjectDeclaration } from './ast.mts'
import { parseStructuredRouteConfigEntries } from './parsers.mts'
import {
  checkCollectionPagePathLiterals,
  checkStructuredCollectionComponentPathLiterals,
  compareSets,
  finiteEnumError,
  hasAllFiles,
  routePageSlugs,
  uniqueSorted,
} from './compare.mts'

export function checkStructuredRouteConfigs(
  errors: string[],
  files: FiniteEnumFiles,
  readTracked: ReadTrackedFile,
  config: NonNullable<FiniteEnumRippleConfig['structured']>,
  backendEntries: StructuredTypeEntry[],
  backendSlugByValue: Map<string, string>,
): void {
  const routeConfigsPath = config.routeConfigsPath
  const backendStructuredsPath = config.backendPath
  if (hasAllFiles(files, [routeConfigsPath])) {
    const routeConfigContent = readTracked(routeConfigsPath)
    if (hasConstObjectDeclaration(routeConfigContent, config.routeConfigObject, routeConfigsPath)) {
      const routeConfigs = parseStructuredRouteConfigEntries(
        routeConfigContent,
        routeConfigsPath,
        config.routeConfigObject,
        config.typeArrayProperty,
        config.routeExemptionProperty,
        config.pluralPathProperty,
        config.singularPathProperty,
      )
      const slugPluralByValue = new Map(
        backendEntries.map((entry) => [entry.value, entry.slugPlural]),
      )
      const valueBySlug = new Map(backendEntries.map((entry) => [entry.slug, entry.value]))
      const typedRouteConfigs = routeConfigs.map((routeConfig) => ({
        ...routeConfig,
        inferredStructuredType: valueBySlug.get(routeConfig.singularPath),
      }))
      for (const routeConfig of typedRouteConfigs) {
        if (
          routeConfig.structuredTypes.length > 0 ||
          routeConfig.routeExempt ||
          !routeConfig.inferredStructuredType ||
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
        (routeConfig) => routeConfig.structuredTypes.length > 0,
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
        const structuredType = routeConfig.structuredTypes[0]!
        const expectedSlug = backendSlugByValue.get(structuredType)
        const expectedSlugPlural = slugPluralByValue.get(structuredType)
        if (
          routeConfig.structuredTypes.length === 1 &&
          routeConfig.singularPath === expectedSlug &&
          routeConfig.pluralPath === expectedSlugPlural
        ) {
          continue
        }
        errors.push(
          finiteEnumError(
            routeConfigsPath,
            `${config.routeConfigObject}.${routeConfig.key} maps ${config.singularPathProperty} "${routeConfig.singularPath}" and ${config.pluralPathProperty} "${routeConfig.pluralPath}" to [${routeConfig.structuredTypes.join(', ')}] but ${config.typeObject} expects "${expectedSlug ?? 'missing'}" and "${expectedSlugPlural ?? 'missing'}"`,
          ),
        )
      }
      compareSets(errors, {
        label: `${config.collectionLabel} route config values`,
        actualLabel: `${routeConfigsPath} ${config.routeConfigObject}`,
        actualFile: routeConfigsPath,
        actualValues: enumRouteConfigs.flatMap((routeConfig) => routeConfig.structuredTypes),
        expectedLabel: backendStructuredsPath,
        expectedFile: backendStructuredsPath,
        expectedValues: uniqueSorted(
          enumRouteConfigs.flatMap((routeConfig) =>
            routeConfig.structuredTypes.filter((value) => slugPluralByValue.has(value)),
          ),
        ),
      })
      compareSets(errors, {
        label: `${config.collectionLabel} collection route config paths`,
        actualLabel: `${routeConfigsPath} ${config.routeConfigObject}`,
        actualFile: routeConfigsPath,
        actualValues: enumRouteConfigs.map((routeConfig) => routeConfig.pluralPath),
        expectedLabel: `${backendStructuredsPath} ${config.typeObject} ${config.slugPluralProperty}`,
        expectedFile: backendStructuredsPath,
        expectedValues: enumRouteConfigs.flatMap((routeConfig) => {
          const slugPlural = slugPluralByValue.get(routeConfig.structuredTypes[0]!)
          return slugPlural ? [slugPlural] : []
        }),
      })
      compareSets(errors, {
        label: `${config.collectionLabel} top-level collection route directories`,
        actualLabel: config.routeLabels.collectionTop,
        actualFile: files.structuredCollectionPages[0]?.file ?? routeConfigsPath,
        actualValues: routePageSlugs(files.structuredCollectionPages, true),
        expectedLabel: `${routeConfigsPath} ${config.routeConfigObject} ${config.pluralPathProperty}`,
        expectedFile: routeConfigsPath,
        expectedValues: routeConfigs.map((routeConfig) => routeConfig.pluralPath),
      })
      compareSets(errors, {
        label: `${config.collectionLabel} collection routed pages`,
        actualLabel: config.routeLabels.collection,
        actualFile: files.structuredCollectionPages[0]?.file ?? routeConfigsPath,
        actualValues: uniqueSorted(files.structuredCollectionPages.map((page) => page.slug)),
        expectedLabel: `${routeConfigsPath} ${config.routeConfigObject} ${config.pluralPathProperty}`,
        expectedFile: routeConfigsPath,
        expectedValues: routeConfigs.map((routeConfig) => routeConfig.pluralPath),
      })
      checkCollectionPagePathLiterals(
        files.structuredCollectionPages,
        errors,
        config.collectionLabel,
        new Set(routeConfigs.map((routeConfig) => routeConfig.pluralPath)),
        readTracked,
        config.collectionPathLiteralPattern,
      )
      checkStructuredCollectionComponentPathLiterals(
        errors,
        routeConfigs,
        files.structuredComponentFiles,
        new Set(config.ignoredNavigationPaths),
        readTracked,
        config.collectionLabel,
        config.navigationPathLiteralPattern,
      )
    }
  }
}
