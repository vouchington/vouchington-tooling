import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { lstatOrNull, writeGeneratedFile } from './file-safety.mts'
import { markdownFilesOnDisk } from './markdown-files.mts'
import { writeSchemaSnapshot } from './generate.mts'
import { renderSchemaMarkdown } from './render-markdown.mts'
import { widgetsTable } from './snapshot.test-helpers.mts'
import type { SchemaSnapshot } from './types.mts'

const snapshot: SchemaSnapshot = {
  formatVersion: 2,
  tables: {
    widgets: widgetsTable(),
  },
  views: {},
  enums: {},
  extensions: {},
  functions: {},
  policies: {},
}

describe('writeSchemaSnapshot path safety', () => {
  const roots: string[] = []

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'schema-snapshot-safety-'))
    roots.push(root)
    return root
  }

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { force: true, recursive: true, maxRetries: 5 })),
    )
  })

  it('does not follow symlinked Markdown path components when writing generated files', async () => {
    const root = await tempRoot()
    const sentinelRoot = await tempRoot()
    const sentinelPath = join(sentinelRoot, 'widgets.md')
    const sentinel = 'Do not overwrite this file.\n'
    await mkdir(join(root, 'markdown'), { recursive: true })
    await writeFile(sentinelPath, sentinel)
    await symlink(sentinelRoot, join(root, 'markdown/tables'))

    await expect(
      writeSchemaSnapshot({ snapshot, markdown: renderSchemaMarkdown(snapshot), root }),
    ).rejects.toThrow('Unsafe generated PostgreSQL schema snapshot path')
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe(sentinel)
  })

  it('does not follow symlinked Markdown leaves when writing generated files', async () => {
    const root = await tempRoot()
    const sentinelRoot = await tempRoot()
    const sentinelPath = join(sentinelRoot, 'widgets.md')
    const sentinel = 'Do not overwrite this file.\n'
    await mkdir(join(root, 'markdown/tables'), { recursive: true })
    await writeFile(sentinelPath, sentinel)
    await symlink(sentinelPath, join(root, 'markdown/tables/widgets.md'))

    await expect(
      writeSchemaSnapshot({ snapshot, markdown: renderSchemaMarkdown(snapshot), root }),
    ).rejects.toThrow('Unsafe generated PostgreSQL schema snapshot path')
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe(sentinel)
  })

  it('does not follow a symlinked JSON snapshot when writing generated files', async () => {
    const root = await tempRoot()
    const sentinelRoot = await tempRoot()
    const sentinelPath = join(sentinelRoot, 'schema.json')
    const sentinel = 'Do not overwrite this file.\n'
    await writeFile(sentinelPath, sentinel)
    await symlink(sentinelPath, join(root, 'schema.json'))

    await expect(
      writeSchemaSnapshot({ snapshot, markdown: renderSchemaMarkdown(snapshot), root }),
    ).rejects.toThrow('Unsafe generated PostgreSQL schema snapshot path')
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe(sentinel)
  })

  it('rejects symlinked Markdown path components in check mode', async () => {
    const root = await tempRoot()
    const sentinelRoot = await tempRoot()
    const sentinelPath = join(sentinelRoot, 'widgets.md')
    const sentinel = 'Do not read this file.\n'
    await writeFile(sentinelPath, sentinel)
    await symlink(sentinelRoot, join(root, 'markdown'))

    await expect(
      writeSchemaSnapshot({
        snapshot,
        markdown: renderSchemaMarkdown(snapshot),
        check: true,
        root,
      }),
    ).rejects.toThrow('Unsafe generated PostgreSQL schema snapshot path')
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe(sentinel)
  })

  it('rejects symlinked Markdown leaves in check mode', async () => {
    const root = await tempRoot()
    const sentinelRoot = await tempRoot()
    const sentinelPath = join(sentinelRoot, 'widgets.md')
    const sentinel = 'Do not read this file.\n'
    await mkdir(join(root, 'markdown/tables'), { recursive: true })
    await writeFile(sentinelPath, sentinel)
    await symlink(sentinelPath, join(root, 'markdown/tables/widgets.md'))

    await expect(
      writeSchemaSnapshot({
        snapshot,
        markdown: renderSchemaMarkdown(snapshot),
        check: true,
        root,
      }),
    ).rejects.toThrow('Unsafe generated PostgreSQL schema snapshot path')
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe(sentinel)
  })

  it('rejects a symlinked JSON snapshot in check mode', async () => {
    const root = await tempRoot()
    const sentinelRoot = await tempRoot()
    const sentinelPath = join(sentinelRoot, 'schema.json')
    const sentinel = 'Do not read this file.\n'
    await writeFile(sentinelPath, sentinel)
    await symlink(sentinelPath, join(root, 'schema.json'))

    await expect(
      writeSchemaSnapshot({
        snapshot,
        markdown: renderSchemaMarkdown(snapshot),
        check: true,
        root,
      }),
    ).rejects.toThrow('Unsafe generated PostgreSQL schema snapshot path')
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe(sentinel)
  })

  it('rejects a non-directory Markdown parent component in check mode', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'markdown'), { recursive: true })
    await writeFile(join(root, 'markdown/tables'), 'Not a directory.\n')

    await expect(
      writeSchemaSnapshot({
        snapshot,
        markdown: renderSchemaMarkdown(snapshot),
        check: true,
        root,
      }),
    ).rejects.toThrow('Unsafe generated PostgreSQL schema snapshot path')
  })

  it('rejects a symlinked snapshot root when writing generated files', async () => {
    const parent = await tempRoot()
    const root = join(parent, 'snapshot')
    const sentinelRoot = await tempRoot()
    await symlink(sentinelRoot, root)

    await expect(
      writeSchemaSnapshot({ snapshot, markdown: renderSchemaMarkdown(snapshot), root }),
    ).rejects.toThrow('Unsafe generated PostgreSQL schema snapshot path')
  })

  it('rejects generated files that escape the snapshot root', async () => {
    const root = await tempRoot()
    await expect(writeGeneratedFile(root, join(root, '../escape.json'), 'nope\n')).rejects.toThrow(
      'Unsafe generated PostgreSQL schema snapshot path',
    )
    await expect(writeGeneratedFile(root, root, 'nope\n')).rejects.toThrow(
      'Unsafe generated PostgreSQL schema snapshot path',
    )
  })

  it('rejects a markdown tree that is a file rather than a directory', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'markdown'), 'Not a directory.\n')
    await expect(markdownFilesOnDisk(root)).rejects.toThrow(
      'Unsafe generated PostgreSQL schema snapshot path',
    )
  })

  it('propagates non-ENOENT lstat failures', async () => {
    const root = await tempRoot()
    const hidden = join(root, 'hidden')
    await mkdir(hidden)
    await writeFile(join(hidden, 'file'), 'x\n')
    await chmod(hidden, 0o000)
    try {
      await expect(lstatOrNull(join(hidden, 'file'))).rejects.toThrow()
    } finally {
      await chmod(hidden, 0o755)
    }
  })

  it('propagates mkdir failures other than EEXIST', async () => {
    const root = await tempRoot()
    const file = join(root, 'not-a-dir')
    await writeFile(file, 'x\n')
    await expect(
      writeGeneratedFile(root, join(file, 'child', 'out.json'), '{}\n'),
    ).rejects.toThrow()
  })

  it('propagates non-ENOENT read failures in check mode', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'schema.json'))
    await expect(
      writeSchemaSnapshot({
        snapshot,
        markdown: renderSchemaMarkdown(snapshot),
        check: true,
        root,
      }),
    ).rejects.toThrow()
  })

  it('skips non-file Markdown directory entries', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'markdown'), { recursive: true })
    await promisify(execFile)('mkfifo', [join(root, 'markdown/pipe')])
    expect(await markdownFilesOnDisk(root)).toEqual([])
  })

  it('collects symlink leaves when scanning generated Markdown', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'markdown'), { recursive: true })
    await writeFile(join(root, 'markdown/real.md'), '# Real\n')
    await symlink(join(root, 'markdown/real.md'), join(root, 'markdown/link.md'))
    expect(await markdownFilesOnDisk(root)).toEqual([
      join(root, 'markdown/link.md'),
      join(root, 'markdown/real.md'),
    ])
  })
})
