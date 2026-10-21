import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TypeScriptModuleFacts } from 'no-mistakes'
import { patternMatches, type StoryCoverageConfig } from './options.mts'

export type ComponentExport = {
  key: string
  file: string
  exportName: string
  displayName: string
}

export function exportKey(file: string, exportName: string): string {
  return `${file}#${exportName}`
}

export function componentExports(
  files: readonly string[],
  modules: ReadonlyMap<string, TypeScriptModuleFacts>,
  config: StoryCoverageConfig,
): ComponentExport[] {
  const found: ComponentExport[] = []
  for (const file of files) {
    if (!isComponentFile(file, config)) continue
    if (!patternMatches(config.marker, readFileSync(join(config.root, file), 'utf8'))) continue
    const facts = modules.get(file)
    if (!facts?.complete) throw new Error(`Incomplete component module facts: ${file}`)
    for (const item of facts.exports) {
      if (item.specifier || item.typeOnly) continue
      if (item.exported !== 'default' && !/^[A-Z][A-Za-z0-9]*$/.test(item.exported)) continue
      found.push({
        key: exportKey(file, item.exported),
        file,
        exportName: item.exported,
        displayName: item.exported === 'default' ? item.local || 'default' : item.exported,
      })
    }
  }
  return found
}

function isComponentFile(file: string, config: StoryCoverageConfig): boolean {
  if (!file.startsWith(config.componentRoot)) return false
  if (!config.componentExtensions.some((extension) => file.endsWith(extension))) return false
  if (file.includes('/__tests__/') || file.includes('.test.')) return false
  return true
}
