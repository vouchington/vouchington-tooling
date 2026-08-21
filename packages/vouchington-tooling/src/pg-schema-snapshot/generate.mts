import { readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { buildSchemaSnapshot } from './build-snapshot.mts'
import { readSchemaCatalog } from './catalog-queries.mts'
import {
  assertSafeExistingFilePath,
  ensureSafeParentDirectory,
  lstatOrNull,
  writeGeneratedFile,
} from './file-safety.mts'
import { markdownFilesOnDisk } from './markdown-files.mts'
import { renderSchemaMarkdown } from './render-markdown.mts'
import type { CatalogQuery, SchemaGrowthMaps, SchemaSnapshot } from './types.mts'

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortKeys(nested)]),
    )
  }
  return value
}

async function identityFormat(_path: string, raw: string): Promise<string> {
  return raw
}

function assertSafeMarkdownPath(markdownRoot: string, path: string): string {
  const outputPath = resolve(markdownRoot, path)
  const relativePath = relative(markdownRoot, outputPath)
  if (
    isAbsolute(path) ||
    !path.endsWith('.md') ||
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Unsafe generated PostgreSQL schema Markdown path: ${path}`)
  }
  return outputPath
}

async function schemaSnapshotFiles(
  snapshot: SchemaSnapshot,
  markdown: Map<string, string>,
  root: string,
  format: (path: string, raw: string) => Promise<string>,
  stringify: (value: unknown) => string,
): Promise<Map<string, string>> {
  const jsonPath = join(root, 'schema.json')
  const markdownRoot = join(root, 'markdown')
  const [json, ...formattedMarkdown] = await Promise.all([
    format(jsonPath, stringify(snapshot)),
    ...[...markdown].map(async ([path, content]) => {
      const outputPath = assertSafeMarkdownPath(markdownRoot, path)
      return [outputPath, await format(outputPath, content)] as const
    }),
  ])
  return new Map([[jsonPath, json], ...formattedMarkdown])
}

async function staleSchemaSnapshotFiles(
  files: Map<string, string>,
  root: string,
): Promise<string[]> {
  const results = await Promise.all(
    [...files].map(async ([path, content]) => {
      await assertSafeExistingFilePath(root, path)
      const actual = await readFile(path, 'utf8').catch((err: NodeJS.ErrnoException) =>
        /* v8 ignore next -- non-ENOENT read failures are host-specific */
        err.code === 'ENOENT' ? null : Promise.reject(err),
      )
      return actual === content ? null : path
    }),
  )
  return results.filter((path): path is string => path !== null)
}

async function extraMarkdownPaths(files: Map<string, string>, root: string): Promise<string[]> {
  const expected = new Set(files.keys())
  const orphaned = (await markdownFilesOnDisk(root)).filter((path) => !expected.has(path))
  const legacyPath = join(root, 'schema.md')
  const legacyExists = (await lstatOrNull(legacyPath)) !== null
  return [...orphaned, ...(legacyExists ? [legacyPath] : [])]
}

export async function writeSchemaSnapshot({
  snapshot,
  markdown,
  root,
  check = false,
  format = identityFormat,
  stringify = stableStringify,
}: {
  snapshot: SchemaSnapshot
  markdown: Map<string, string>
  root: string
  check?: boolean
  format?: (path: string, raw: string) => Promise<string>
  stringify?: (value: unknown) => string
}): Promise<void> {
  const files = await schemaSnapshotFiles(snapshot, markdown, root, format, stringify)
  if (!check) {
    await Promise.all([...files.keys()].map((path) => ensureSafeParentDirectory(root, path)))
    await Promise.all([...files].map(([path, content]) => writeGeneratedFile(root, path, content)))
    await Promise.all((await extraMarkdownPaths(files, root)).map((path) => rm(path)))
    return
  }

  const stale = [
    ...(await staleSchemaSnapshotFiles(files, root)),
    ...(await extraMarkdownPaths(files, root)),
  ].toSorted((left, right) => left.localeCompare(right))
  if (stale.length > 0) {
    throw new Error(
      [
        'PostgreSQL schema snapshot is stale. Regenerate it and commit:',
        ...stale.map((path) => `- ${path}`),
      ].join('\n'),
    )
  }
}

export async function generateSchemaSnapshot({
  query,
  growth,
  root,
  check = false,
  format = identityFormat,
  stringify = stableStringify,
}: {
  query: CatalogQuery
  growth: SchemaGrowthMaps
  root: string
  check?: boolean
  format?: (path: string, raw: string) => Promise<string>
  stringify?: (value: unknown) => string
}): Promise<void> {
  const snapshot = buildSchemaSnapshot(await readSchemaCatalog(query), growth)
  await writeSchemaSnapshot({
    snapshot,
    markdown: renderSchemaMarkdown(snapshot),
    root,
    check,
    format,
    stringify,
  })
}
