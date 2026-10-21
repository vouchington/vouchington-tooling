import { relative, resolve } from 'node:path'
import { analyzeTypeScriptModules, type TypeScriptModuleFacts } from 'no-mistakes'
import { createSourceModuleGraph, type SourceModuleGraph } from '../source-module-graph/index.mts'
import type { StoryCoverageConfig } from './options.mts'

export type StorySourceAnalysis = {
  graph: SourceModuleGraph
  modules: ReadonlyMap<string, TypeScriptModuleFacts>
}

export async function analyzeStorySources(
  files: readonly string[],
  config: StoryCoverageConfig,
): Promise<StorySourceAnalysis> {
  const facts = await analyzeTypeScriptModules({ root: config.root, files: [...files] })
  const modules = new Map<string, TypeScriptModuleFacts>()
  for (const item of facts.modules) {
    const file = relative(config.root, resolve(config.root, item.fileName)).replaceAll('\\', '/')
    if (!item.complete) throw new Error(`Incomplete source module facts: ${file}`)
    modules.set(file, item)
  }
  if (modules.size !== files.length || files.some((file) => !modules.has(file))) {
    throw new Error('Incomplete story source inventory')
  }
  const graph = createSourceModuleGraph({
    root: config.root,
    extensions: config.sourceExtensions,
    aliases: config.aliases,
    files,
    facts,
  })
  return { graph, modules }
}
