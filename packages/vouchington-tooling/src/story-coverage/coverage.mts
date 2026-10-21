import type { SourceModuleGraph } from '../source-module-graph/index.mts'
import { patternMatches, type StoryCoverageConfig } from './options.mts'
import { exportKey } from './components.mts'

export type NamespaceComponentImport = {
  file: string
  source: string
  local: string
}

export function reachableStoryFiles(
  files: readonly string[],
  graph: SourceModuleGraph,
  config: StoryCoverageConfig,
): string[] {
  const stories = files.filter(
    (file) => file.startsWith(config.storyRoot) && patternMatches(config.storyFilePattern, file),
  )
  return graph
    .reachableFrom(stories, { runtimeOnly: true })
    .filter((file) => file.startsWith(config.storyRoot))
}

export function coveredComponentKeys(
  storyFiles: readonly string[],
  graph: SourceModuleGraph,
  config: StoryCoverageConfig,
): Set<string> {
  const covered = new Set<string>()
  for (const file of storyFiles) {
    for (const entry of graph.runtimeImports(file)) {
      const resolved = graph.resolveSource(file, entry.specifier)
      if (!resolved?.startsWith(config.componentRoot)) continue
      for (const binding of entry.bindings) {
        if (binding.kind === 'namespace') continue
        covered.add(exportKey(resolved, binding.imported))
        const owner = graph.resolveExportOwner(resolved, binding.imported)
        if (owner) covered.add(exportKey(owner.file, owner.exportName))
      }
    }
  }
  return covered
}

export function namespaceComponentImports(
  storyFiles: readonly string[],
  graph: SourceModuleGraph,
  config: StoryCoverageConfig,
): NamespaceComponentImport[] {
  const imports: NamespaceComponentImport[] = []
  for (const file of storyFiles) {
    for (const entry of graph.runtimeImports(file)) {
      const resolved = graph.resolveSource(file, entry.specifier)
      if (!resolved?.startsWith(config.componentRoot)) continue
      for (const binding of entry.bindings) {
        if (binding.kind !== 'namespace') continue
        imports.push({ file, source: entry.specifier, local: binding.local })
      }
    }
  }
  return imports
}
