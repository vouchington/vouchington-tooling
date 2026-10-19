import type { StoryCoverageConfig } from './options.mts'
import type { NamespaceComponentImport } from './coverage.mts'

export type MissingComponent = {
  component: string
  exportName: string
  file: string
}

export function formatMissingComponentsMessage(
  missingComponents: readonly MissingComponent[],
  config: StoryCoverageConfig,
): string {
  if (missingComponents.length === 0) return ''
  const lines = [
    `${missingComponents.length} component(s) matching the marker have no story coverage.`,
    '',
    `For each missing component, add a story under ${config.storyRoot} that imports the component through a configured path alias.`,
    '',
    `Use 'default' for default exports when matching the key reported below.`,
    `The zero-exclusion ratchet rejects entries in ${config.exclusionsLabel}.`,
    '',
    'Missing components:',
  ]
  for (const { component, exportName, file } of missingComponents) {
    lines.push(`  ${component} — ${file}#${exportName}`)
    lines.push('')
  }
  return lines.join('\n')
}

export function formatNamespaceImportsMessage(
  namespaceImports: readonly NamespaceComponentImport[],
  config: StoryCoverageConfig,
): string {
  if (namespaceImports.length === 0) return ''
  const lines = [
    `${namespaceImports.length} story file(s) use namespace imports (* as ...) from ${config.componentRoot} — individual component coverage cannot be tracked:`,
    '',
  ]
  for (const { file, source, local } of namespaceImports) {
    lines.push(`  ${file}: import * as ${local} from '${source}'`)
  }
  lines.push('')
  lines.push('Fix: replace namespace imports with named imports for the specific components used.')
  return lines.join('\n')
}

export function formatExclusionsMessage(excludedKeys: readonly string[]): string {
  if (excludedKeys.length === 0) return ''
  return [
    `${excludedKeys.length} component story exclusion(s) remain after the zero-exclusion ratchet:`,
    ...excludedKeys.map((key) => `  - ${key}`),
    'Add direct story coverage instead of adding exclusions.',
  ].join('\n')
}
