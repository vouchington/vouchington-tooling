import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  persistentDependencyTreeIsCold,
  persistentMetadataFingerprintV4 as persistentMetadataFingerprint,
  persistentMetadataStatusV4 as persistentMetadataMatches,
  writePersistentMetadataStampV4 as writePersistentMetadataStamp,
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
    })
    expect(fingerprint).toEqual({
      pnpm: expect.stringMatching(/^[0-9a-f]{64}$/),
      lockfile: expect.stringMatching(/^[0-9a-f]{64}$/),
      'npm-config': expect.stringMatching(/^[0-9a-f]{64}$/),
      runtime: expect.stringMatching(/^[0-9a-f]{64}$/),
      pnpmfiles: expect.stringMatching(/^[0-9a-f]{64}$/),
      'workspace-config': expect.stringMatching(/^[0-9a-f]{64}$/),
      'workspace-manifests': expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(await persistentMetadataMatches(fingerprint)).toEqual({ kind: 'absent' })
    expect(await persistentDependencyTreeIsCold()).toBe(true)
    await mkdir(join(root, 'node_modules'))
    expect(await persistentDependencyTreeIsCold()).toBe(false)
    await writePersistentMetadataStamp(fingerprint, true, false)
    expect(await persistentMetadataMatches(fingerprint)).toEqual({
      kind: 'matching',
      lastInvocationInstallScripts: true,
      scriptsEnabledInstallSucceeded: true,
    })
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
      }),
    ).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('fails when pnpm --version fails', async () => {
    await expect(
      persistentMetadataFingerprint(async (args) => {
        if (args[0] === '--version') return { code: 1, output: '', errorOutput: 'nope' }
        return { code: 0, output: JSON.stringify([{ name: 'root', path: process.cwd() }]) }
      }),
    ).rejects.toThrow('pnpm --version failed: nope')
    await expect(
      persistentMetadataFingerprint(async (args) => {
        if (args[0] === '--version') return { code: 1, output: 'stdout-only' }
        return { code: 0, output: JSON.stringify([{ name: 'root', path: process.cwd() }]) }
      }),
    ).rejects.toThrow('pnpm --version failed: stdout-only')
    await expect(
      persistentMetadataFingerprint(async (args) => {
        if (args[0] === '--version') return { code: 1, output: '' }
        return { code: 0, output: JSON.stringify([{ name: 'root', path: process.cwd() }]) }
      }),
    ).rejects.toThrow('pnpm --version failed: unknown error')
  })

  it('uses structural provenance independent of script policy and records successful script execution monotonically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pnpm-metadata-v4-'))
    dirs.push(root)
    await writeFile(join(root, 'package.json'), '{"name":"root"}\n')
    process.chdir(root)
    const capture = async (args: string[]) =>
      args[0] === '--version'
        ? { code: 0, output: '11.0.0\n' }
        : { code: 0, output: JSON.stringify([{ name: 'root', path: root }]) }
    const provenance = await persistentMetadataFingerprint(capture)
    await writePersistentMetadataStamp(provenance, true, false)
    await writePersistentMetadataStamp(provenance, false, false)
    expect(await persistentMetadataMatches(provenance)).toMatchObject({
      lastInvocationInstallScripts: false,
      scriptsEnabledInstallSucceeded: true,
    })
  })

  it('reports component categories for structural changes and unsafe metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pnpm-metadata-components-'))
    dirs.push(root)
    await writeFile(join(root, 'package.json'), '{"name":"root"}\n')
    process.chdir(root)
    let version = '11.0.0\n'
    const capture = async (args: string[]) =>
      args[0] === '--version'
        ? { code: 0, output: version }
        : { code: 0, output: JSON.stringify([{ name: 'root', path: root }]) }
    const assertCategory = async (category: string, change: () => Promise<void>) => {
      const before = await persistentMetadataFingerprint(capture)
      await writePersistentMetadataStamp(before, false, false)
      await change()
      const after = await persistentMetadataFingerprint(capture)
      expect(await persistentMetadataMatches(after)).toEqual({
        components: [category],
        kind: 'changed',
      })
      await writePersistentMetadataStamp(after, false, false)
    }
    await assertCategory('lockfile', () => writeFile(join(root, 'pnpm-lock.yaml'), 'lockfile: 2\n'))
    await assertCategory('workspace-config', () =>
      writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: []\n'),
    )
    await assertCategory('npm-config', () => writeFile(join(root, '.npmrc'), 'registry=x\n'))
    await assertCategory('pnpmfiles', () =>
      writeFile(join(root, '.pnpmfile.cjs'), 'module.exports={}\n'),
    )
    await assertCategory('workspace-manifests', () =>
      writeFile(join(root, 'package.json'), '{"name":"changed"}\n'),
    )
    await assertCategory('pnpm', async () => {
      version = '11.1.0\n'
    })
    const previousArch = process.env.npm_config_arch
    try {
      await assertCategory('runtime', async () => {
        process.env.npm_config_arch = 'fixture-arch'
      })
    } finally {
      if (previousArch === undefined) delete process.env.npm_config_arch
      else process.env.npm_config_arch = previousArch
    }
    const after = await persistentMetadataFingerprint(capture)
    await writeFile(
      join(root, 'node_modules', '.pnpm-install-metadata-health.json'),
      '{"version":3}\n',
    )
    expect(await persistentMetadataMatches(after)).toEqual({ kind: 'unsafe' })
  })
})
