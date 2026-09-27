import type { ConfigInventory } from './types.mts'

export function formatConfigInventoryMarkdown(inventory: ConfigInventory): string {
  return [
    '# Configuration Inventory',
    '',
    'Generated from caller-selected repository files.',
    '',
    '## Environment Variables',
    '',
    '| Name | Classifications | Contract | Source of truth | Sensitivity | Surfaces | Readers | Local setup | Deployment | Docker build args | Workflows | Docs | Package gates | Review |',
    '| ---- | --------------- | -------- | --------------- | ----------- | -------- | ------- | ----------- | ---------- | ----------------- | --------- | ---- | ------------- | ------ |',
    ...inventory.envVars.map((row) =>
      tableRow([
        code(row.name),
        row.classifications.map(code).join(', '),
        row.contractKeys.map(code).join('<br>'),
        row.sourceOfTruth ? code(row.sourceOfTruth) : '',
        row.sensitivity ? code(row.sensitivity) : '',
        row.runtimeSurfaces.map(code).join('<br>'),
        formatFiles(row.readers),
        formatFiles(row.localSetup),
        formatFiles(row.deployment),
        formatFiles(row.dockerBuildArgs),
        formatFiles(row.workflows),
        formatFiles(row.docs),
        formatFiles(row.packageGates),
        escapeTextCell(row.reviewReason ?? ''),
      ]),
    ),
    '',
    '## Dynamic Configuration Namespaces',
    '',
    '| Namespace | Definitions | Registry |',
    '| --------- | ----------- | -------------- |',
    ...inventory.dynamicConfigs.map((row) =>
      tableRow([
        code(row.namespace),
        formatFiles(row.definitionFiles),
        formatFiles(row.registryFiles),
      ]),
    ),
    '',
    '## Package-Manager Gates',
    '',
    '| Gate | Values | Files |',
    '| ---- | ------ | ----- |',
    ...inventory.packageGates.map((row) =>
      tableRow([code(row.name), row.values.map(code).join(', '), formatFiles(row.files)]),
    ),
    '',
  ].join('\n')
}

function formatFiles(files: readonly string[]): string {
  return files.length === 0 ? '' : files.map((file) => code(file)).join('<br>')
}

function tableRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`
}

function code(value: string): string {
  const delimiter = '`'.repeat(
    Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length)) + 1,
  )
  const content = escapeCodeCell(value)
  const padding =
    content.includes('`') || content.startsWith(' ') || content.endsWith(' ') ? ' ' : ''
  return `${delimiter}${padding}${content}${padding}${delimiter}`
}

function escapeCodeCell(value: string): string {
  return value.replaceAll('|', String.raw`\|`).replaceAll(/\r\n|\r|\n/g, ' ')
}

function escapeTextCell(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('|', '&#124;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('`', '&#96;')
    .replaceAll(/\r\n|\r|\n/g, ' ')
}
