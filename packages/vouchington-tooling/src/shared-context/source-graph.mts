import type {
  TypeScriptModuleFacts,
  TypeScriptModuleImport,
  TypeScriptModulesReport,
} from 'no-mistakes'
import { resolve } from 'node:path'
import { createExportOwnerResolver } from './source-graph-owner.mts'
import { relativeFile, resolveSourcePath, type SourceGraphPaths } from './source-graph-resolve.mts'

export type SourceModuleGraphOptions = {
  root: string
  extensions: readonly string[]
  aliases?: Readonly<Record<string, string>>
  files: readonly string[]
  facts: TypeScriptModulesReport
  /** Caps the supplied file inventory and every traversal. */
  maxFiles?: number
}

export type SourceExportOwner = { file: string; exportName: string }

export type SourceModuleGraph = {
  resolveSource(fromFile: string, specifier: string): string | null
  runtimeImports(file: string): TypeScriptModuleImport[]
  reachableFrom(entrypoints: readonly string[], options?: { runtimeOnly?: boolean }): string[]
  resolveExportOwner(file: string, exportName: string): SourceExportOwner | null
}

/** Resolve only caller-supplied files; syntax and binding facts come from no-mistakes. */
export function createSourceModuleGraph(options: SourceModuleGraphOptions): SourceModuleGraph {
  const root = resolve(options.root)
  const maxFiles = options.maxFiles ?? 10_000
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || options.files.length > maxFiles) {
    throw new Error('Source graph file limit exceeded')
  }
  const fileSet = new Set<string>()
  for (const file of options.files) {
    const normalized = relativeFile(root, file)
    if (!normalized) throw new Error(`Source graph file escapes root: ${file}`)
    fileSet.add(normalized)
  }
  const paths: SourceGraphPaths = {
    root,
    extensions: options.extensions,
    aliases: options.aliases ?? {},
    files: fileSet,
  }
  const modules = new Map<string, TypeScriptModuleFacts>()
  for (const module of options.facts.modules) {
    const file = relativeFile(root, module.fileName)
    if (!file || !fileSet.has(file) || modules.has(file)) {
      throw new Error(`Unexpected source module facts: ${module.fileName}`)
    }
    modules.set(file, module)
  }

  function factsFor(file: string): TypeScriptModuleFacts {
    const facts = modules.get(file)
    if (!facts || !facts.complete) throw new Error(`Incomplete source module facts: ${file}`)
    return facts
  }

  function runtimeImports(file: string): TypeScriptModuleImport[] {
    const facts = factsFor(file)
    return facts.imports.flatMap((entry) => {
      if (entry.typeOnly) return []
      if (entry.bindings.length === 0) return [entry] // Side-effect import.
      const bindings = entry.bindings.filter((imported) => {
        if (imported.typeOnly) return false
        const binding = facts.bindings.find((item) => item.id === imported.bindingId)
        if (!binding) throw new Error(`Missing import binding facts: ${file}`)
        return binding.references.some((reference) => reference.runtime && !reference.typeOnly)
      })
      return bindings.length > 0 ? [{ ...entry, bindings }] : []
    })
  }

  function reachableFrom(
    entrypoints: readonly string[],
    traversal: { runtimeOnly?: boolean } = {},
  ): string[] {
    const queue = entrypoints.map((file) => relativeFile(root, file))
    const seen = new Set<string>()
    for (let index = 0; index < queue.length; index++) {
      const file = queue[index]
      if (!file || !fileSet.has(file) || seen.has(file)) continue
      seen.add(file)
      const facts = factsFor(file)
      const imports = traversal.runtimeOnly ? runtimeImports(file) : facts.imports
      const specifiers = [
        ...imports.map((item) => item.specifier),
        ...facts.exports.flatMap((item) =>
          item.specifier && (!traversal.runtimeOnly || !item.typeOnly) ? [item.specifier] : [],
        ),
        ...facts.loads.map((item) => item.specifier),
      ]
      for (const specifier of specifiers) {
        const resolved = resolveSourcePath(paths, file, specifier)
        if (resolved && !seen.has(resolved)) queue.push(resolved)
      }
    }
    return [...seen].sort()
  }

  return {
    resolveSource: (fromFile, specifier) => resolveSourcePath(paths, fromFile, specifier),
    runtimeImports,
    reachableFrom,
    resolveExportOwner: createExportOwnerResolver(paths, factsFor),
  }
}
