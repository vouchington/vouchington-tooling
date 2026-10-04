import type { FiniteEnumFiles, FiniteEnumRippleConfig, ReadTrackedFile } from './model.mts'
import { hasConfiguredObjectDeclaration } from './ast.mts'
import { checkUnionFactories } from './union-factory-check.mts'
import {
  checkCollectionPagePathLiterals,
  checkUnionCreatePageTypes,
  compareSets,
  finiteEnumError,
  hasAllFiles,
  routePageSlugs,
  uniqueSorted,
} from './compare.mts'
import {
  parseUnionRouteConfigEntries,
  parseUnionSlugToType,
  parseUnionTypeUnion,
} from './parsers.mts'

export function checkUnionTypes(
  errors: string[],
  files: FiniteEnumFiles,
  readTracked: ReadTrackedFile,
  config: NonNullable<FiniteEnumRippleConfig['union']>,
): void {
  const unionTypesPath = config.typesPath
  const routeConfigsPath = config.routeConfigsPath
  if (!hasAllFiles(files, [unionTypesPath, routeConfigsPath])) return

  const unionTypes = parseUnionTypeUnion(
    readTracked(unionTypesPath),
    unionTypesPath,
    config.typeAlias,
  )
  const publicUnionTypes = unionTypes.filter((value) => !config.internalTypes.includes(value))
  const routeConfigContent = readTracked(routeConfigsPath)
  const slugToType = parseUnionSlugToType(
    routeConfigContent,
    routeConfigsPath,
    config.slugMapObject,
  )
  const topRouteSlugs = routePageSlugs(files.unionDetailPages, true)
  const routeSlugs = routePageSlugs(files.unionDetailPages)

  compareSets(errors, {
    label: `${config.collectionLabel} route config values`,
    actualLabel: `${routeConfigsPath} ${config.slugMapObject}`,
    actualFile: routeConfigsPath,
    actualValues: [...slugToType.values()],
    expectedLabel: `${unionTypesPath} public ${config.typeAlias} values`,
    expectedFile: unionTypesPath,
    expectedValues: publicUnionTypes,
  })
  compareSets(errors, {
    label: `${config.collectionLabel} route directories`,
    actualLabel: config.routeLabels.detailTop,
    actualFile: files.unionDetailPages[0]?.file ?? routeConfigsPath,
    actualValues: topRouteSlugs,
    expectedLabel: `${routeConfigsPath} ${config.slugMapObject} slugs`,
    expectedFile: routeConfigsPath,
    expectedValues: [...slugToType.keys()],
  })
  compareSets(errors, {
    label: `${config.collectionLabel} routed pages`,
    actualLabel: config.routeLabels.detail,
    actualFile: files.unionDetailPages[0]?.file ?? routeConfigsPath,
    actualValues: routeSlugs,
    expectedLabel: `${routeConfigsPath} ${config.slugMapObject} slugs`,
    expectedFile: routeConfigsPath,
    expectedValues: [...slugToType.keys()],
  })

  if (
    hasConfiguredObjectDeclaration(routeConfigContent, config.routeConfigObject, routeConfigsPath)
  ) {
    const routeConfigs = parseUnionRouteConfigEntries(
      routeConfigContent,
      routeConfigsPath,
      config.routeConfigObject,
      config.typeArrayProperty,
      config.pluralPathProperty,
      config.singularPathProperty,
    )
    const typedRouteConfigs = routeConfigs.filter(
      (routeConfig) => routeConfig.unionTypes.length > 0,
    )
    for (const routeConfig of routeConfigs) {
      if (
        routeConfig.unionTypes.length > 0 ||
        config.routeConfigExceptions.includes(routeConfig.key)
      )
        continue
      errors.push(
        finiteEnumError(
          routeConfigsPath,
          `${config.routeConfigObject}.${routeConfig.key} has ${config.singularPathProperty} "${routeConfig.singularPath}" but does not declare ${config.typeArrayProperty}`,
        ),
      )
    }
    for (const routeConfig of routeConfigs) {
      if (routeConfig.key === routeConfig.pluralPath) continue
      errors.push(
        finiteEnumError(
          routeConfigsPath,
          `${config.routeConfigObject}.${routeConfig.key} has ${config.pluralPathProperty} "${routeConfig.pluralPath}" but the route config key is "${routeConfig.key}"`,
        ),
      )
    }
    compareSets(errors, {
      label: `${config.collectionLabel} collection route config values`,
      actualLabel: `${routeConfigsPath} ${config.routeConfigObject}`,
      actualFile: routeConfigsPath,
      actualValues: typedRouteConfigs.flatMap((routeConfig) => routeConfig.unionTypes),
      expectedLabel: `${unionTypesPath} public ${config.typeAlias} values`,
      expectedFile: unionTypesPath,
      expectedValues: publicUnionTypes,
    })
    compareSets(errors, {
      label: `${config.collectionLabel} collection route config singular paths`,
      actualLabel: `${routeConfigsPath} ${config.routeConfigObject}`,
      actualFile: routeConfigsPath,
      actualValues: typedRouteConfigs.map((routeConfig) => routeConfig.singularPath),
      expectedLabel: `${routeConfigsPath} ${config.slugMapObject} slugs`,
      expectedFile: routeConfigsPath,
      expectedValues: [...slugToType.keys()],
    })
    for (const routeConfig of typedRouteConfigs) {
      const expectedType = slugToType.get(routeConfig.singularPath)
      if (
        expectedType !== undefined &&
        routeConfig.unionTypes.length === 1 &&
        routeConfig.unionTypes[0] === expectedType
      ) {
        continue
      }
      errors.push(
        finiteEnumError(
          routeConfigsPath,
          `${config.routeConfigObject}.${routeConfig.key} maps ${config.singularPathProperty} "${routeConfig.singularPath}" to [${routeConfig.unionTypes.join(', ')}] but ${config.slugMapObject} expects "${expectedType ?? 'missing'}"`,
        ),
      )
    }
    compareSets(errors, {
      label: `${config.collectionLabel} top-level collection route directories`,
      actualLabel: config.routeLabels.collectionTop,
      actualFile: files.unionCollectionPages[0]?.file ?? routeConfigsPath,
      actualValues: routePageSlugs(files.unionCollectionPages, true),
      expectedLabel: `${routeConfigsPath} ${config.routeConfigObject} ${config.pluralPathProperty}`,
      expectedFile: routeConfigsPath,
      expectedValues: routeConfigs.map((routeConfig) => routeConfig.pluralPath),
    })
    compareSets(errors, {
      label: `${config.collectionLabel} collection routed pages`,
      actualLabel: config.routeLabels.collection,
      actualFile: files.unionCollectionPages[0]?.file ?? routeConfigsPath,
      actualValues: uniqueSorted(files.unionCollectionPages.map((page) => page.slug)),
      expectedLabel: `${routeConfigsPath} ${config.routeConfigObject} ${config.pluralPathProperty}`,
      expectedFile: routeConfigsPath,
      expectedValues: routeConfigs.map((routeConfig) => routeConfig.pluralPath),
    })
    checkUnionCreatePageTypes(
      errors,
      typedRouteConfigs,
      files.unionCreatePages,
      readTracked,
      config.createPageTypeProperties,
      config.collectionLabel,
    )
    checkCollectionPagePathLiterals(
      files.unionCollectionPages,
      errors,
      config.collectionLabel,
      new Set(typedRouteConfigs.map((routeConfig) => routeConfig.pluralPath)),
      readTracked,
      config.collectionPathLiteralPattern,
    )
  }

  checkUnionFactories(errors, files.unionDetailPages, readTracked, config, slugToType, routeSlugs)
}
