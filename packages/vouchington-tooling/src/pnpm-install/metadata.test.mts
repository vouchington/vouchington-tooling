import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  persistentDependencyTreeIsCold,
  persistentMetadataFingerprint,
  persistentMetadataMatches,
  writePersistentMetadataStamp,
} from './metadata.mts'

const dirs: string[] = []
const previousCwd = process.cwd()

afterEach(async () => {
  process.chdir(previousCwd)
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

describe('persistent metadata', () => {
  it('fingerprints workspaces and stamps matching metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pnpm-metadata-'))
    dirs.push(root)
    await writeFile(join(root, 'package.json'), '{"name":"root"}\n')
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    process.chdir(root)
    const fingerprint = await persistentMetadataFingerprint(async (args) => {
      if (args[0] === '--version') return { code: 0, output: '11.0.0\n' }
      return { code: 0, output: JSON.stringify([{ name: 'root', path: root }]) }
    }, true)
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(await persistentMetadataMatches(fingerprint)).toBe(false)
    expect(await persistentDependencyTreeIsCold()).toBe(true)
    await mkdir(join(root, 'node_modules'))
    expect(await persistentDependencyTreeIsCold()).toBe(false)
    await writePersistentMetadataStamp(fingerprint)
    expect(await persistentMetadataMatches(fingerprint)).toBe(true)
    expect(await persistentMetadataMatches('deadbeef')).toBe(false)
  })

  it('rethrows non-ENOENT fingerprint and cold-tree errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pnpm-metadata-err-'))
    dirs.push(root)
    await writeFile(join(root, 'package.json'), '{"name":"root"}\n')
    await mkdir(join(root, 'pnpm-lock.yaml'))
    process.chdir(root)
    await expect(
      persistentMetadataFingerprint(async (args) => {
        if (args[0] === '--version') return { code: 0, output: '11.0.0\n' }
        return { code: 0, output: JSON.stringify([{ name: 'root', path: root }]) }
      }, true),
    ).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('fails when pnpm --version fails', async () => {
    await expect(
      persistentMetadataFingerprint(async (args) => {
        if (args[0] === '--version') return { code: 1, output: '', errorOutput: 'nope' }
        return { code: 0, output: JSON.stringify([{ name: 'root', path: process.cwd() }]) }
      }, false),
    ).rejects.toThrow('pnpm --version failed: nope')
    await expect(
      persistentMetadataFingerprint(async (args) => {
        if (args[0] === '--version') return { code: 1, output: 'stdout-only' }
        return { code: 0, output: JSON.stringify([{ name: 'root', path: process.cwd() }]) }
      }, false),
    ).rejects.toThrow('pnpm --version failed: stdout-only')
    await expect(
      persistentMetadataFingerprint(async (args) => {
        if (args[0] === '--version') return { code: 1, output: '' }
        return { code: 0, output: JSON.stringify([{ name: 'root', path: process.cwd() }]) }
      }, false),
    ).rejects.toThrow('pnpm --version failed: unknown error')
  })
})
