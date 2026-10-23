import type { ClocCategories, ClocConfig } from './config.mts'
import { compilePatterns, normalizePath } from './patterns.mts'

export type CategoryKey = keyof ClocCategories
export type Classification = { category: CategoryKey; service: string }

/** Builds the path classifier for a layout: tests, then tooling, else source; first service wins. */
export function createClassifier(config: ClocConfig): (filePath: string) => Classification {
  const isTest = compilePatterns(config.testPatterns)
  const isTooling = compilePatterns(config.toolingPatterns)
  const rules = config.services.map((rule) => ({
    name: rule.name,
    matches: compilePatterns(rule.match),
  }))
  return (filePath) => {
    const normalized = normalizePath(filePath)
    const category: CategoryKey = isTest(normalized)
      ? 'tests'
      : isTooling(normalized)
        ? 'tooling'
        : 'source'
    const service = rules.find((rule) => rule.matches(normalized))?.name ?? config.defaultService
    return { category, service }
  }
}
