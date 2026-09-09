import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { writeGeneratedFiles } from './write-generated-files.mts'

describe('writeGeneratedFiles', () => {
  it('writes files and deletes obsolete json in update mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'write-generated-files-'))
    const responses = join(root, 'responses')
    await mkdir(responses, { recursive: true })
    await writeFile(join(responses, 'obsolete.json'), '{"stale":true}\n')
    const keep = join(responses, 'keep.json')

    await writeGeneratedFiles({
      files: new Map([[keep, '{"ok":true}\n']]),
      obsoleteDirectory: responses,
      staleError: (paths) => new Error(`stale:\n${paths.join('\n')}`),
    })

    expect(await readFile(keep, 'utf8')).toBe('{"ok":true}\n')
    expect(await readdir(responses)).toEqual(['keep.json'])
  })

  it('reports missing and obsolete paths in check mode without writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'write-generated-files-check-'))
    const responses = join(root, 'responses')
    await mkdir(responses, { recursive: true })
    const expected = join(responses, 'expected.json')
    const obsolete = join(responses, 'obsolete.json')
    await writeFile(obsolete, '{"stale":true}\n')

    await expect(
      writeGeneratedFiles({
        files: new Map([[expected, '{"ok":true}\n']]),
        check: true,
        obsoleteDirectory: responses,
        staleError: (paths) => new Error(`stale:\n${paths.toSorted().join('\n')}`),
      }),
    ).rejects.toThrow(`stale:\n${[expected, obsolete].toSorted().join('\n')}`)

    expect(await readdir(responses)).toEqual(['obsolete.json'])
  })

  it('passes check mode when bytes match and no obsolete files remain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'write-generated-files-ok-'))
    const file = join(root, 'manifest.json')
    const content = '{"version":1}\n'
    await writeFile(file, content)

    await expect(
      writeGeneratedFiles({
        files: new Map([[file, content]]),
        check: true,
        staleError: (paths) => new Error(paths.join(',')),
      }),
    ).resolves.toBeUndefined()
  })

  it('treats a missing obsolete directory as empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'write-generated-files-missing-'))
    const file = join(root, 'manifest.json')
    await writeGeneratedFiles({
      files: new Map([[file, '{}\n']]),
      obsoleteDirectory: join(root, 'responses'),
      staleError: (paths) => new Error(paths.join(',')),
    })
    expect(await readFile(file, 'utf8')).toBe('{}\n')
  })
})
