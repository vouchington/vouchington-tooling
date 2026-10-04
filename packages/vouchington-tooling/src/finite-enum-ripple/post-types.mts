import type { FiniteEnumFiles, FiniteEnumRippleConfig, ReadTrackedFile } from './model.mts'
import {
  checkCollectionPagePathLiterals,
  checkPostCreatePageTypes,
  compareSets,
  finiteEnumError,
  hasAllFiles,
  routePageSlugs,
  uniqueSorted,
} from './compare.mts'
import {
  parsePostDetailRouteFactoryArgs,
  parsePostRouteConfigEntries,
  parsePostSlugToType,
  parsePostTypeUnion,
} from './parsers.mts'

export function checkPostTypes(
  errors: string[],
  files: FiniteEnumFiles,
  readTracked: ReadTrackedFile,
  config: NonNullable<FiniteEnumRippleConfig['post']>,
): void {
  const postTypesPath = config.typesPath
  const routeConfigsPath = config.routeConfigsPath
  if (!hasAllFiles(files, [postTypesPath, routeConfigsPath])) return

  const postTypes = parsePostTypeUnion(readTracked(postTypesPath), postTypesPath, config.typeAlias)
  const publicPostTypes = postTypes.filter((value) => !config.internalTypes.includes(value))
  const routeConfigContent = readTracked(routeConfigsPath)
  const slugToType = parsePostSlugToType(routeConfigContent, routeConfigsPath, config.slugMapObject)
  const topRouteSlugs = routePageSlugs(files.postDetailPages, true)
  const routeSlugs = routePageSlugs(files.postDetailPages)

  compareSets(errors, {
    label: `${config.collectionLabel} route config values`,
    actualLabel: `${routeConfigsPath} ${config.slugMapObject}`,
    actualValues: [...slugToType.values()],
    expectedLabel: `${postTypesPath} public ${config.typeAlias} values`,
    expectedValues: publicPostTypes,
  })
  compareSets(errors, {
    label: `${config.collectionLabel} route directories`,
    actualLabel: config.routeLabels.detailTop,
    actualValues: topRouteSlugs,
    expectedLabel: `${routeConfigsPath} ${config.slugMapObject} slugs`,
    expectedValues: [...slugToType.keys()],
  })
  compareSets(errors, {
    label: `${config.collectionLabel} routed pages`,
    actualLabel: config.routeLabels.detail,
    actualValues: routeSlugs,
    expectedLabel: `${routeConfigsPath} ${config.slugMapObject} slugs`,
    expectedValues: [...slugToType.keys()],
  })

  if (routeConfigContent.includes(config.routeConfigObject)) {
    const routeConfigs = parsePostRouteConfigEntries(
      routeConfigContent,
      routeConfigsPath,
      config.routeConfigObject,
      config.typeArrayProperty,
      config.pluralPathProperty,
      config.singularPathProperty,
    )
    const typedRouteConfigs = routeConfigs.filter((routeConfig) => routeConfig.postTypes.length > 0)
    for (const routeConfig of routeConfigs) {
      if (
        routeConfig.postTypes.length > 0 ||
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
      actualValues: typedRouteConfigs.flatMap((routeConfig) => routeConfig.postTypes),
      expectedLabel: `${postTypesPath} public ${config.typeAlias} values`,
      expectedValues: publicPostTypes,
    })
    compareSets(errors, {
      label: `${config.collectionLabel} collection route config singular paths`,
      actualLabel: `${routeConfigsPath} ${config.routeConfigObject}`,
      actualValues: typedRouteConfigs.map((routeConfig) => routeConfig.singularPath),
      expectedLabel: `${routeConfigsPath} ${config.slugMapObject} slugs`,
      expectedValues: [...slugToType.keys()],
    })
    for (const routeConfig of typedRouteConfigs) {
      const expectedType = slugToType.get(routeConfig.singularPath)
      if (
        expectedType &&
        routeConfig.postTypes.length === 1 &&
        routeConfig.postTypes[0] === expectedType
      ) {
        continue
      }
      errors.push(
        finiteEnumError(
          routeConfigsPath,
          `${config.routeConfigObject}.${routeConfig.key} maps ${config.singularPathProperty} "${routeConfig.singularPath}" to [${routeConfig.postTypes.join(', ')}] but ${config.slugMapObject} expects "${expectedType ?? 'missing'}"`,
        ),
      )
    }
    compareSets(errors, {
      label: `${config.collectionLabel} top-level collection route directories`,
      actualLabel: config.routeLabels.collectionTop,
      actualValues: routePageSlugs(files.postCollectionPages, true),
      expectedLabel: `${routeConfigsPath} ${config.routeConfigObject} ${config.pluralPathProperty}`,
      expectedValues: routeConfigs.map((routeConfig) => routeConfig.pluralPath),
    })
    compareSets(errors, {
      label: `${config.collectionLabel} collection routed pages`,
      actualLabel: config.routeLabels.collection,
      actualValues: uniqueSorted(files.postCollectionPages.map((page) => page.slug)),
      expectedLabel: `${routeConfigsPath} ${config.routeConfigObject} ${config.pluralPathProperty}`,
      expectedValues: routeConfigs.map((routeConfig) => routeConfig.pluralPath),
    })
    checkPostCreatePageTypes(
      errors,
      typedRouteConfigs,
      files.postCreatePages,
      readTracked,
      config.createPageTypeProperties,
      config.collectionLabel,
    )
    checkCollectionPagePathLiterals(
      files.postCollectionPages,
      errors,
      config.collectionLabel,
      new Set(typedRouteConfigs.map((routeConfig) => routeConfig.pluralPath)),
      readTracked,
      config.collectionPathLiteralPattern,
    )
  }

  const detailFactoryArgs = files.postDetailPages.flatMap((page) =>
    parsePostDetailRouteFactoryArgs(
      readTracked(page.file),
      page.file,
      config.factoryCallPattern,
    ).map((args) => ({
      ...args,
      file: page.file,
      routeSlug: page.slug,
    })),
  )
  compareSets(errors, {
    label: `${config.collectionLabel} route factory slugs`,
    actualLabel: config.routeLabels.factory,
    actualValues: uniqueSorted(detailFactoryArgs.map((args) => args.slug)),
    expectedLabel: config.routeLabels.detail,
    expectedValues: routeSlugs,
  })
  compareSets(errors, {
    label: `${config.collectionLabel} route factory values`,
    actualLabel: config.routeLabels.factory,
    actualValues: uniqueSorted(detailFactoryArgs.map((args) => args.postType)),
    expectedLabel: `${routeConfigsPath} ${config.slugMapObject} values`,
    expectedValues: [...slugToType.values()],
  })
  for (const args of detailFactoryArgs) {
    const expectedType = slugToType.get(args.routeSlug)
    if (args.slug === args.routeSlug && expectedType === args.postType) continue
    errors.push(
      finiteEnumError(
        args.file,
        `${config.collectionLabel} route factory args mismatch; route directory is "${args.routeSlug}" and expected type is "${expectedType ?? 'missing'}" but factory uses "${args.postType}", "${args.slug}"`,
      ),
    )
  }
}
