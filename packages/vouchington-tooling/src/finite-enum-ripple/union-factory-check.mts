import type { FiniteEnumRippleConfig, ReadTrackedFile, RoutedPage } from './model.mts'
import { compareSets, finiteEnumError, uniqueSorted } from './compare.mts'
import { parseUnionDetailRouteFactoryArgs } from './parsers.mts'

export function checkUnionFactories(
  errors: string[],
  pages: readonly RoutedPage[],
  readTracked: ReadTrackedFile,
  config: NonNullable<FiniteEnumRippleConfig['union']>,
  slugToType: ReadonlyMap<string, string>,
  routeSlugs: readonly string[],
): void {
  const routeConfigsPath = config.routeConfigsPath
  const detailFactoryArgs = pages.flatMap((page) =>
    parseUnionDetailRouteFactoryArgs(
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
    actualFile: pages[0]?.file ?? routeConfigsPath,
    actualValues: uniqueSorted(detailFactoryArgs.map((args) => args.slug)),
    expectedLabel: config.routeLabels.detail,
    expectedFile: pages[0]?.file ?? routeConfigsPath,
    expectedValues: routeSlugs,
  })
  compareSets(errors, {
    label: `${config.collectionLabel} route factory values`,
    actualLabel: config.routeLabels.factory,
    actualFile: pages[0]?.file ?? routeConfigsPath,
    actualValues: uniqueSorted(detailFactoryArgs.map((args) => args.unionType)),
    expectedLabel: `${routeConfigsPath} ${config.slugMapObject} values`,
    expectedFile: routeConfigsPath,
    expectedValues: [...slugToType.values()],
  })
  for (const args of detailFactoryArgs) {
    const expectedType = slugToType.get(args.routeSlug)
    if (args.slug === args.routeSlug && expectedType === args.unionType) continue
    errors.push(
      finiteEnumError(
        args.file,
        `${config.collectionLabel} route factory args mismatch; route directory is "${args.routeSlug}" and expected type is "${expectedType ?? 'missing'}" but factory uses "${args.unionType}", "${args.slug}"`,
      ),
    )
  }
}
