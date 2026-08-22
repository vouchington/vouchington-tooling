import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { EPOCH_PRUNED_AT, normalizeDeployedLayer, runNormalizeDeployedLayerCli } from './index.mts'

describe('normalizeDeployedLayer', () => {
  const testDirs: string[] = []

  afterEach(() => {
    for (const dir of testDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  })

  function makeProdDir(): string {
    const root = mkdtempSync(path.join(tmpdir(), 'pnpm-deploy-normalize-'))
    testDirs.push(root)
    return path.join(root, 'prod', 'app')
  }

  it('pins prunedAt and preserves the other .modules.yaml keys', () => {
    const prodDir = makeProdDir()
    const modulesPath = path.join(prodDir, 'node_modules', '.modules.yaml')
    mkdirSync(path.dirname(modulesPath), { recursive: true })
    writeFileSync(
      modulesPath,
      `${JSON.stringify(
        {
          hoistedDependencies: { 'left-pad@1.0.0': { 'left-pad': 'private' } },
          packageManager: 'pnpm@11.13.1',
          prunedAt: 'Mon, 17 Aug 2026 04:16:02 GMT',
          storeDir: '/root/.local/share/pnpm/store/v11',
        },
        null,
        2,
      )}\n`,
    )

    const result = normalizeDeployedLayer(prodDir)

    expect(result).toMatchObject({ prunedAtPinned: true })
    expect(JSON.parse(readFileSync(modulesPath, 'utf8'))).toEqual({
      hoistedDependencies: { 'left-pad@1.0.0': { 'left-pad': 'private' } },
      packageManager: 'pnpm@11.13.1',
      prunedAt: EPOCH_PRUNED_AT,
      storeDir: '/root/.local/share/pnpm/store/v11',
    })
  })

  it('clamps file, directory, and symlink mtimes to epoch 0', () => {
    const prodDir = makeProdDir()
    const modulesDir = path.join(prodDir, 'node_modules')
    const filePath = path.join(modulesDir, 'keep.js')
    const linkPath = path.join(modulesDir, 'keep-link')
    mkdirSync(modulesDir, { recursive: true })
    writeFileSync(path.join(modulesDir, '.modules.yaml'), '{}\n')
    writeFileSync(filePath, 'module.exports = true\n')
    symlinkSync('keep.js', linkPath)
    const later = new Date('2026-08-17T04:16:02Z')
    utimesSync(filePath, later, later)
    utimesSync(modulesDir, later, later)

    normalizeDeployedLayer(prodDir)

    expect(lstatSync(filePath).mtimeMs).toBe(0)
    expect(lstatSync(linkPath).mtimeMs).toBe(0)
    expect(lstatSync(modulesDir).mtimeMs).toBe(0)
    expect(lstatSync(prodDir).mtimeMs).toBe(0)
  })

  it('breaks hardlinks before clamping mtimes', () => {
    const prodDir = makeProdDir()
    const storeFile = path.join(path.dirname(prodDir), 'store', 'keep.js')
    const linked = path.join(prodDir, 'node_modules', 'keep.js')
    mkdirSync(path.dirname(storeFile), { recursive: true })
    mkdirSync(path.dirname(linked), { recursive: true })
    writeFileSync(path.join(prodDir, 'node_modules', '.modules.yaml'), '{}\n')
    writeFileSync(storeFile, 'shared\n')
    linkSync(storeFile, linked)
    utimesSync(storeFile, new Date('2026-08-17T04:16:02Z'), new Date('2026-08-17T04:16:02Z'))

    normalizeDeployedLayer(prodDir)

    expect(lstatSync(linked).nlink).toBe(1)
    expect(lstatSync(linked).mtimeMs).toBe(0)
    expect(lstatSync(storeFile).mtimeMs).toBeGreaterThan(0)
  })

  it('fails closed when .modules.yaml is missing', () => {
    const prodDir = makeProdDir()
    mkdirSync(prodDir, { recursive: true })

    expect(() => normalizeDeployedLayer(prodDir)).toThrow(
      /missing; expected pnpm deploy to write it/,
    )
  })

  it.each(['prunedAt: Mon, 17 Aug 2026 04:16:02 GMT\n', 'null', '[]', '1'])(
    'fails closed when .modules.yaml is not a JSON object (%j)',
    (contents) => {
      const prodDir = makeProdDir()
      const modulesPath = path.join(prodDir, 'node_modules', '.modules.yaml')
      mkdirSync(path.dirname(modulesPath), { recursive: true })
      writeFileSync(modulesPath, contents)

      expect(() => normalizeDeployedLayer(prodDir)).toThrow(/JSON/i)
    },
  )
})

describe('runNormalizeDeployedLayerCli', () => {
  it('does nothing when the module is imported', () => {
    const calls: string[] = []

    runNormalizeDeployedLayerCli({
      args: [],
      env: {},
      isMain: false,
      normalize: (prodDir) => {
        calls.push(prodDir)
        return { prunedAtPinned: true, entriesTouched: 1 }
      },
      stdout: (message) => calls.push(message),
    })

    expect(calls).toEqual([])
  })

  it.each([
    [['/argument'], { PROD_DIR: '/environment' }, '/argument'],
    [[], { PROD_DIR: '/environment' }, '/environment'],
  ])('uses argument then environment directory precedence', (args, env, expected) => {
    const calls: string[] = []

    runNormalizeDeployedLayerCli({
      args,
      env,
      isMain: true,
      normalize: (prodDir) => {
        calls.push(prodDir)
        return { prunedAtPinned: true, entriesTouched: 4 }
      },
      stdout: (message) => calls.push(message),
    })

    expect(calls).toEqual([
      expected,
      `Normalized deployed layer at ${expected} (prunedAt pinned, 4 entries)`,
    ])
  })

  it('reports when prunedAt was absent from the normalize result', () => {
    const calls: string[] = []

    runNormalizeDeployedLayerCli({
      args: ['/argument'],
      env: {},
      isMain: true,
      normalize: (prodDir) => {
        calls.push(prodDir)
        return { prunedAtPinned: false, entriesTouched: 2 }
      },
      stdout: (message) => calls.push(message),
    })

    expect(calls).toEqual([
      '/argument',
      'Normalized deployed layer at /argument (prunedAt absent, 2 entries)',
    ])
  })

  it('throws when no directory argument and no PROD_DIR are provided', () => {
    expect(() =>
      runNormalizeDeployedLayerCli({
        args: [],
        env: {},
        isMain: true,
        normalize: () => ({ prunedAtPinned: true, entriesTouched: 0 }),
        stdout: () => undefined,
      }),
    ).toThrow(/PROD_DIR or a directory argument is required/)
  })
})
