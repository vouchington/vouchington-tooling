import { analyzeStorySources } from './analyze.mts'
import { componentExports } from './components.mts'
import {
  coveredComponentKeys,
  namespaceComponentImports,
  reachableStoryFiles,
  type NamespaceComponentImport,
} from './coverage.mts'
import {
  formatExclusionsMessage,
  formatMissingComponentsMessage,
  formatNamespaceImportsMessage,
  type MissingComponent,
} from './messages.mts'
import {
  storyCoverageConfig,
  type StoryCoverageConfig,
  type StoryCoverageRequest,
} from './options.mts'
import { workspaceFiles } from './workspace.mts'

export type StoryCoverageReport = {
  ok: boolean
  namespaceImports: NamespaceComponentImport[]
  excludedKeys: string[]
  missingComponents: MissingComponent[]
  messages: string[]
}

export async function checkStoryCoverage(
  request: StoryCoverageRequest,
  files?: readonly string[],
): Promise<StoryCoverageReport> {
  const config = storyCoverageConfig(request)
  const inventory = [...new Set(files ?? workspaceFiles(config))]
  if (inventory.length === 0) return coverageReport(config, [], new Set(), [])
  const analysis = await analyzeStorySources(inventory, config)
  const storyFiles = reachableStoryFiles(inventory, analysis.graph, config)
  return coverageReport(
    config,
    namespaceComponentImports(storyFiles, analysis.graph, config),
    coveredComponentKeys(storyFiles, analysis.graph, config),
    componentExports(inventory, analysis.modules, config),
  )
}

function coverageReport(
  config: StoryCoverageConfig,
  namespaceImports: NamespaceComponentImport[],
  covered: ReadonlySet<string>,
  components: ReturnType<typeof componentExports>,
): StoryCoverageReport {
  const excludedKeys = Object.keys(config.exclusions).toSorted()
  const excluded = new Set(excludedKeys)
  const missingComponents = components
    .flatMap((component) =>
      covered.has(component.key) || excluded.has(component.key)
        ? []
        : [
            {
              component: component.displayName,
              exportName: component.exportName,
              file: component.file,
            },
          ],
    )
    .toSorted(
      (left, right) =>
        left.file.localeCompare(right.file) || left.exportName.localeCompare(right.exportName),
    )
  const messages = [
    formatNamespaceImportsMessage(namespaceImports, config),
    formatExclusionsMessage(excludedKeys),
    formatMissingComponentsMessage(missingComponents, config),
  ].filter((message) => message !== '')
  return {
    ok: messages.length === 0,
    namespaceImports,
    excludedKeys,
    missingComponents,
    messages,
  }
}
