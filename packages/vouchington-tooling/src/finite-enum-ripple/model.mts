export type ReadTrackedFile = (file: string) => string

export interface RoutedPage {
  file: string
  isTopLevel: boolean
  slug: string
}

export interface FiniteEnumFiles {
  existingFileSet: ReadonlySet<string>
  postCollectionPages: RoutedPage[]
  postCreatePages: RoutedPage[]
  postDetailPages: RoutedPage[]
  topicCollectionPages: RoutedPage[]
  topicComponentFiles: { file: string; slug: string }[]
  topicDetailPages: RoutedPage[]
}

/** Selection and diagnostics are supplied by the consumer, never inferred from its layout. */
export interface FiniteEnumRippleConfig {
  files: FiniteEnumFiles
  /** Appended to every diagnostic; use for a consumer-owned policy guide. */
  diagnosticSuffix?: string
  topic?: {
    backendPath: string
    webPath: string
    routeConfigsPath: string
    typeObject: string
    routeConfigObject: string
    typeArrayProperty: string
    pluralPathProperty: string
    singularPathProperty: string
    spendingCategoryProperty: string
    slugProperty: string
    slugPluralProperty: string
    factoryCallPattern: RegExp
    routeConfigExceptions: readonly string[]
    routeLabels: { detailTop: string; detail: string; collectionTop: string; collection: string }
    collectionLabel: string
    ignoredNavigationPaths: readonly string[]
    collectionPathLiteralPattern: RegExp
    navigationPathLiteralPattern: RegExp
  }
  post?: {
    typesPath: string
    routeConfigsPath: string
    typeAlias: string
    slugMapObject: string
    routeConfigObject: string
    typeArrayProperty: string
    pluralPathProperty: string
    singularPathProperty: string
    factoryCallPattern: RegExp
    internalTypes: readonly string[]
    routeConfigExceptions: readonly string[]
    routeLabels: {
      detailTop: string
      detail: string
      collectionTop: string
      collection: string
      factory: string
    }
    collectionLabel: string
    createPageTypeProperties: readonly string[]
    collectionPathLiteralPattern: RegExp
  }
}
