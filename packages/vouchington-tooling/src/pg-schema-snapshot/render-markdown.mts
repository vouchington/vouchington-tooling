import { renderTableDocument } from './render-tables.mts'
import type { SchemaSnapshot } from './types.mts'

export type SchemaMarkdownFiles = Map<string, string>

const SAFE_TABLE_FILENAME = /^[a-z][a-z0-9_]*$/

function heading(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`
}

function renderViewsDocument(snapshot: SchemaSnapshot): string {
  const names = Object.keys(snapshot.views).toSorted((left, right) => left.localeCompare(right))
  const lines = [heading(1, 'Views'), '', '[Schema index](README.md).']
  if (names.length === 0) return `${[...lines, '', '_none_'].join('\n')}\n`
  for (const name of names) {
    const view = snapshot.views[name]!
    lines.push('', heading(2, `\`${name}\`${view.materialized ? ' (materialized)' : ''}`))
    if (view.comment) lines.push('', view.comment)
    lines.push('', '```sql', view.definition, '```')
  }
  return `${lines.join('\n')}\n`
}

function renderEnumsDocument(snapshot: SchemaSnapshot): string {
  const names = Object.keys(snapshot.enums).toSorted((left, right) => left.localeCompare(right))
  const lines = [heading(1, 'Enums'), '', '[Schema index](README.md).']
  if (names.length === 0) return `${[...lines, '', '_none_'].join('\n')}\n`
  for (const name of names) {
    lines.push(
      '',
      heading(2, `\`${name}\``),
      ...snapshot.enums[name]!.values.map((value) => `- \`${value}\``),
    )
  }
  return `${lines.join('\n')}\n`
}

function renderExtensionsDocument(snapshot: SchemaSnapshot): string {
  const names = Object.keys(snapshot.extensions).toSorted((left, right) =>
    left.localeCompare(right),
  )
  const lines = [
    heading(1, 'Extensions'),
    '',
    '[Schema index](README.md).',
    '',
    '| Extension | Version |',
    '| --- | --- |',
  ]
  lines.push(...names.map((name) => `| \`${name}\` | ${snapshot.extensions[name]!.version} |`))
  return `${lines.join('\n')}\n`
}

function renderFunctionSignature(definition: string): string {
  const lines = definition.split('\n')
  const bodyStart = lines.findIndex((line) => line.trim().startsWith('AS $'))
  return (bodyStart === -1 ? lines : lines.slice(0, bodyStart)).join('\n')
}

function renderFunctionsDocument(snapshot: SchemaSnapshot): string {
  const names = Object.keys(snapshot.functions).toSorted((left, right) => left.localeCompare(right))
  const lines = [heading(1, 'Functions'), '', '[Schema index](README.md).']
  if (names.length === 0) return `${[...lines, '', '_none_'].join('\n')}\n`
  for (const name of names) {
    lines.push(
      '',
      heading(2, `\`${name}\``),
      '',
      '```sql',
      renderFunctionSignature(snapshot.functions[name]!.definition),
      '```',
    )
  }
  return `${lines.join('\n')}\n`
}

function renderPoliciesDocument(snapshot: SchemaSnapshot): string {
  const names = Object.keys(snapshot.policies).toSorted((left, right) => left.localeCompare(right))
  const lines = [heading(1, 'Row-Level Security Policies'), '', '[Schema index](README.md).']
  if (names.length === 0) return `${[...lines, '', '_none_'].join('\n')}\n`
  for (const name of names) {
    const policy = snapshot.policies[name]!
    lines.push(
      '',
      heading(2, `\`${name}\``),
      `- command: \`${policy.command}\``,
      `- roles: ${policy.pgRoles.map((role) => `\`${role}\``).join(', ')}`,
      `- using: ${policy.using ? `\`${policy.using}\`` : '_none_'}`,
      `- with check: ${policy.withCheck ? `\`${policy.withCheck}\`` : '_none_'}`,
    )
  }
  return `${lines.join('\n')}\n`
}

function markdownTablePath(name: string): string {
  if (!SAFE_TABLE_FILENAME.test(name)) {
    throw new Error(
      `Cannot generate a safe Markdown filename for PostgreSQL table ${JSON.stringify(name)}.`,
    )
  }
  return `tables/${name}.md`
}

function renderSchemaIndex(tableNames: string[]): string {
  const lines = [
    '# PostgreSQL Schema Snapshot',
    '',
    'Generated schema snapshot. Do not hand-edit. Full function bodies live only in the companion [`schema.json`](../schema.json).',
    '',
    '## Tables',
    '',
    ...tableNames.map((name) => `- [\`${name}\`](tables/${name}.md)`),
    '',
    '## Other schema objects',
    '',
    '- [Views](views.md)',
    '- [Enums](enums.md)',
    '- [Extensions](extensions.md)',
    '- [Functions](functions.md)',
    '- [Row-Level Security Policies](policies.md)',
  ]
  return `${lines.join('\n')}\n`
}

/**
 * Renders deterministic, focused Markdown files from the same snapshot serialized to schema.json.
 * Each table receives one safe filename and exactly one column table; the index directly links all
 * generated leaves.
 */
export function renderSchemaMarkdown(snapshot: SchemaSnapshot): SchemaMarkdownFiles {
  const tableNames = Object.keys(snapshot.tables).toSorted((left, right) =>
    left.localeCompare(right),
  )
  const files: SchemaMarkdownFiles = new Map()
  files.set('README.md', renderSchemaIndex(tableNames))
  for (const name of tableNames) {
    files.set(markdownTablePath(name), renderTableDocument(name, snapshot.tables[name]!))
  }
  files.set('views.md', renderViewsDocument(snapshot))
  files.set('enums.md', renderEnumsDocument(snapshot))
  files.set('extensions.md', renderExtensionsDocument(snapshot))
  files.set('functions.md', renderFunctionsDocument(snapshot))
  files.set('policies.md', renderPoliciesDocument(snapshot))
  return files
}
