import type { ReadTrackedFile } from './model.mts'
import { collectActivePatternCaptures } from './pattern-captures.mts'
import { finiteEnumError } from './compare.mts'

export function checkStructuredCollectionComponentPathLiterals(
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
    if (!config) {
      errors.push(
        finiteEnumError(file, `${label} component has no matching route config for "${slug}"`),
      )
      continue
    }
    const content = readTracked(file)
    for (const literalPath of collectNavigationPathLiterals(
      content,
      file,
      ignoredNavigationPaths,
      navigationPattern,
    )) {
      if (
        matchesConfiguredPath(literalPath, config.pluralPath) ||
        matchesConfiguredPath(literalPath, config.singularPath)
      )
        continue
      errors.push(
        finiteEnumError(
          file,
          `${label} component navigation path "/${literalPath}" does not match route config "${config.singularPath}" or "${config.pluralPath}"`,
        ),
      )
    }
  }
}

function matchesConfiguredPath(literalPath: string, configuredPath: string): boolean {
  return literalPath === configuredPath || literalPath.startsWith(`${configuredPath}/`)
}

function collectNavigationPathLiterals(
  content: string,
  file: string,
  ignoredPaths: ReadonlySet<string>,
  pattern: RegExp,
): string[] {
  const paths: string[] = []
  for (const literalPath of collectActivePatternCaptures(content, pattern, file)) {
    if (!ignoredPaths.has(literalPath)) paths.push(literalPath)
  }
  return paths
}
