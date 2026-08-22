import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { pruneDeployedRuntimeDeps, runPruneDeployedRuntimeDepsCli } from './index.mts'

describe('pruneDeployedRuntimeDeps', () => {
  const testDirs: string[] = []

  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  async function makeProdDir(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'pnpm-deploy-prune-'))
    testDirs.push(root)

    return path.join(root, 'prod', 'app')
  }

  it('removes TypeScript declaration artifacts from the deployed pnpm store', async () => {
    const prodDir = await makeProdDir()
    const packageDir = path.join(
      prodDir,
      'node_modules',
      '.pnpm',
      'example@1.0.0',
      'node_modules',
      'example',
    )
    await mkdir(packageDir, { recursive: true })
    await writeFile(path.join(packageDir, 'index.js'), 'module.exports = true\n')
    await writeFile(path.join(packageDir, 'index.d.ts'), 'export declare const value: true\n')
    await writeFile(path.join(packageDir, 'index.d.ts.map'), '{}\n')
    await writeFile(path.join(packageDir, 'index.d.mts'), 'export declare const value: true\n')
    await writeFile(path.join(packageDir, 'index.d.mts.map'), '{}\n')
    await writeFile(path.join(packageDir, 'index.d.cts'), 'export declare const value: true\n')
    await writeFile(path.join(packageDir, 'index.d.cts.map'), '{}\n')
    await writeFile(path.join(packageDir, 'tsconfig.tsbuildinfo'), '{}\n')
    await symlink('index.js', path.join(packageDir, 'index.js.link'))

    const result = pruneDeployedRuntimeDeps(prodDir)

    expect(result).toMatchObject({ filesRemoved: 7 })
    expect(result.bytesRemoved).toBeGreaterThan(0)
    await expect(readFile(path.join(packageDir, 'index.js'), 'utf8')).resolves.toBe(
      'module.exports = true\n',
    )
    await expect(stat(path.join(packageDir, 'index.d.ts'))).rejects.toThrow(/ENOENT/)
    await expect(stat(path.join(packageDir, 'index.d.ts.map'))).rejects.toThrow(/ENOENT/)
    await expect(stat(path.join(packageDir, 'index.d.mts'))).rejects.toThrow(/ENOENT/)
    await expect(stat(path.join(packageDir, 'index.d.mts.map'))).rejects.toThrow(/ENOENT/)
    await expect(stat(path.join(packageDir, 'index.d.cts'))).rejects.toThrow(/ENOENT/)
    await expect(stat(path.join(packageDir, 'index.d.cts.map'))).rejects.toThrow(/ENOENT/)
    await expect(stat(path.join(packageDir, 'tsconfig.tsbuildinfo'))).rejects.toThrow(/ENOENT/)
    await expect(readFile(path.join(packageDir, 'index.js.link'), 'utf8')).resolves.toBe(
      'module.exports = true\n',
    )
  })

  it('does nothing when the pnpm store is absent', async () => {
    const prodDir = await makeProdDir()

    expect(pruneDeployedRuntimeDeps(prodDir)).toEqual({ bytesRemoved: 0, filesRemoved: 0 })
  })
})

describe('runPruneDeployedRuntimeDepsCli', () => {
  it('does nothing when the module is imported', () => {
    const calls: string[] = []

    runPruneDeployedRuntimeDepsCli({
      args: [],
      env: {},
      isMain: false,
      prune: (prodDir) => {
        calls.push(prodDir)
        return { bytesRemoved: 0, filesRemoved: 0 }
      },
      stdout: (message) => calls.push(message),
    })

    expect(calls).toEqual([])
  })

  it('uses PROD_DIR when no directory argument is provided', () => {
    const calls: string[] = []

    runPruneDeployedRuntimeDepsCli({
      args: [],
      env: { PROD_DIR: '/env/prod' },
      isMain: true,
      prune: (prodDir) => {
        calls.push(prodDir)
        return { bytesRemoved: 12, filesRemoved: 2 }
      },
      stdout: (message) => calls.push(message),
    })

    expect(calls).toEqual([
      '/env/prod',
      'Pruned 2 runtime dependency artifact(s) from /env/prod (12 bytes)',
    ])
  })

  it('prunes every explicit directory argument', () => {
    const calls: string[] = []

    runPruneDeployedRuntimeDepsCli({
      args: ['/one', '/two'],
      env: { PROD_DIR: '/ignored' },
      isMain: true,
      prune: (prodDir) => {
        calls.push(prodDir)
        return { bytesRemoved: prodDir.length, filesRemoved: 1 }
      },
      stdout: (message) => calls.push(message),
    })

    expect(calls).toEqual([
      '/one',
      'Pruned 1 runtime dependency artifact(s) from /one (4 bytes)',
      '/two',
      'Pruned 1 runtime dependency artifact(s) from /two (4 bytes)',
    ])
  })

  it('throws when no directory argument and no PROD_DIR are provided', () => {
    expect(() =>
      runPruneDeployedRuntimeDepsCli({
        args: [],
        env: {},
        isMain: true,
        prune: () => ({ bytesRemoved: 0, filesRemoved: 0 }),
        stdout: () => undefined,
      }),
    ).toThrow(/PROD_DIR or a directory argument is required/)
  })
})
