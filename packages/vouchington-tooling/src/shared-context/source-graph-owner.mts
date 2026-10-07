import type { TypeScriptModuleFacts } from 'no-mistakes'
import { relativeFile, resolveSourcePath, type SourceGraphPaths } from './source-graph-resolve.mts'
import type { SourceExportOwner } from './source-graph.mts'

export function createExportOwnerResolver(
  paths: SourceGraphPaths,
  factsFor: (file: string) => TypeScriptModuleFacts,
): (file: string, exportName: string) => SourceExportOwner | null {
  return (file, exportName) => {
    const start = relativeFile(paths.root, file)
    if (!start || !paths.files.has(start)) return null
    const queue = [{ file: start, exportName }]
    const seen = new Set<string>()
    const owners = new Map<string, SourceExportOwner>()
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]!
      const key = `${current.file}\0${current.exportName}`
      if (seen.has(key)) continue
      seen.add(key)
      const facts = factsFor(current.file)
      const direct = facts.exports.filter(
        (item) => !item.typeOnly && item.exported === current.exportName,
      )
      const matches =
        direct.length > 0
          ? direct
          : current.exportName === 'default'
            ? [] // ESM export-star never reexports default.
            : facts.exports.filter(
                (item) => !item.typeOnly && item.local === '*' && item.exported === '*',
              )
      for (const item of matches) {
        if (item.specifier) {
          const target = resolveSourcePath(paths, current.file, item.specifier)
          if (target && item.local === '*' && item.exported !== '*') {
            owners.set(`${target}\0*`, { file: target, exportName: '*' })
          } else if (target) {
            queue.push({
              file: target,
              exportName: item.local === '*' ? current.exportName : item.local,
            })
          }
          continue
        }
        const imported = facts.imports.flatMap((entry) =>
          entry.bindings
            .filter((binding) => !binding.typeOnly && binding.local === item.local)
            .map((binding) => ({ entry, binding })),
        )[0]
        if (imported) {
          const target = resolveSourcePath(paths, current.file, imported.entry.specifier)
          if (target) queue.push({ file: target, exportName: imported.binding.imported })
          continue
        }
        const owner = { file: current.file, exportName: item.exported }
        owners.set(`${owner.file}\0${owner.exportName}`, owner)
      }
    }
    return owners.size === 1 ? [...owners.values()][0]! : null
  }
}
