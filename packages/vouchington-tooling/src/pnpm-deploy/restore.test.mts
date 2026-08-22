import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  restoreDeployedWorkspacePackages,
  runRestoreDeployedWorkspacePackagesCli,
} from './index.mts'

const ALPHA_STORE = '@services+alpha@file+backend+services+alpha'
const CONFIG_STORE = '@workspace+config@file+backend+config'
const UTILS_STORE = '@ts-shared+utils@file+ts-shared+utils'
const PG_STORE = 'pg@8.0.0'

function relativeSymlink(linkPath: string, target: string): void {
  mkdirSync(path.dirname(linkPath), { recursive: true })
  symlinkSync(path.relative(path.dirname(linkPath), target), linkPath, 'dir')
}

describe('restoreDeployedWorkspacePackages', () => {
  const testDirs: string[] = []

  afterEach(() => {
    for (const dir of testDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  })

  function makeFixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'pnpm-deploy-restore-'))
    testDirs.push(root)

    const backendDir = path.join(root, 'app', 'backend')
    mkdirSync(path.join(backendDir, 'services', 'alpha'), { recursive: true })
    mkdirSync(path.join(backendDir, 'services', 'empty'), { recursive: true })
    mkdirSync(path.join(backendDir, 'services', 'noname'), { recursive: true })
    mkdirSync(path.join(backendDir, 'config'), { recursive: true })
    mkdirSync(path.join(root, 'app', 'ts-shared', 'utils'), { recursive: true })
    writeFileSync(path.join(backendDir, 'services', 'README'), 'not a workspace package\n')
    writeFileSync(
      path.join(backendDir, 'package.json'),
      JSON.stringify({
        name: '@workspace/backend',
        workspaces: ['services/*', 'config', 'missing/*', '../ts-shared/*'],
      }),
    )
    writeFileSync(
      path.join(backendDir, 'services', 'alpha', 'package.json'),
      JSON.stringify({ name: '@services/alpha' }),
    )
    writeFileSync(path.join(backendDir, 'services', 'noname', 'package.json'), JSON.stringify({}))
    writeFileSync(
      path.join(backendDir, 'config', 'package.json'),
      JSON.stringify({ name: '@workspace/config' }),
    )
    writeFileSync(
      path.join(root, 'app', 'ts-shared', 'utils', 'package.json'),
      JSON.stringify({ name: '@ts-shared/utils' }),
    )

    const prodDir = path.join(root, 'prod', 'backend')
    const pnpmRoot = path.join(prodDir, 'node_modules', '.pnpm')

    const alphaContent = path.join(pnpmRoot, ALPHA_STORE, 'node_modules', '@services', 'alpha')
    mkdirSync(alphaContent, { recursive: true })
    writeFileSync(path.join(alphaContent, 'index.mts'), 'export const alpha = true\n')

    const configContent = path.join(pnpmRoot, CONFIG_STORE, 'node_modules', '@workspace', 'config')
    mkdirSync(configContent, { recursive: true })
    writeFileSync(path.join(configContent, 'env.mts'), 'export const env = true\n')

    const utilsContent = path.join(pnpmRoot, UTILS_STORE, 'node_modules', '@ts-shared', 'utils')
    mkdirSync(utilsContent, { recursive: true })
    writeFileSync(path.join(utilsContent, 'strings.mts'), 'export const strings = true\n')

    const pgContent = path.join(pnpmRoot, PG_STORE, 'node_modules', 'pg')
    mkdirSync(pgContent, { recursive: true })
    writeFileSync(path.join(pgContent, 'index.js'), 'module.exports = {}\n')

    relativeSymlink(
      path.join(pnpmRoot, ALPHA_STORE, 'node_modules', '@workspace', 'config'),
      configContent,
    )
    relativeSymlink(path.join(pnpmRoot, ALPHA_STORE, 'node_modules', 'pg'), pgContent)
    relativeSymlink(path.join(prodDir, 'node_modules', '@services', 'alpha'), alphaContent)

    const hoistDecoy = path.join(pnpmRoot, 'node_modules', '@services', 'alpha')
    mkdirSync(hoistDecoy, { recursive: true })
    writeFileSync(path.join(hoistDecoy, 'index.mts'), 'hoisted decoy\n')
    writeFileSync(path.join(pnpmRoot, '.modules.yaml'), 'hoistPattern: []\n')

    return { alphaContent, backendDir, pnpmRoot, prodDir, root }
  }

  it('relocates virtual-store workspace copies and leaves symlinks behind', () => {
    const { alphaContent, backendDir, prodDir } = makeFixture()

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    const relocated = path.join(prodDir, 'workspace-packages', ALPHA_STORE, '@services', 'alpha')
    expect(readFileSync(path.join(relocated, 'index.mts'), 'utf8')).toBe(
      'export const alpha = true\n',
    )
    expect(lstatSync(alphaContent).isSymbolicLink()).toBe(true)
    expect(readFileSync(path.join(alphaContent, 'index.mts'), 'utf8')).toBe(
      'export const alpha = true\n',
    )

    const topLevel = path.join(prodDir, 'node_modules', '@services', 'alpha')
    expect(readFileSync(path.join(topLevel, 'index.mts'), 'utf8')).toBe(
      'export const alpha = true\n',
    )
    expect(realpathSync(topLevel).split(path.sep)).not.toContain('node_modules')
  })

  it('creates a node_modules backlink so relocated packages resolve deps through pnpm topology', () => {
    const { backendDir, pnpmRoot, prodDir } = makeFixture()

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    const relocated = path.join(prodDir, 'workspace-packages', ALPHA_STORE, '@services', 'alpha')
    const backlink = path.join(relocated, 'node_modules')
    expect(lstatSync(backlink).isSymbolicLink()).toBe(true)
    expect(realpathSync(backlink)).toBe(
      realpathSync(path.join(pnpmRoot, ALPHA_STORE, 'node_modules')),
    )

    const configThroughAlpha = path.join(backlink, '@workspace', 'config')
    expect(readFileSync(path.join(configThroughAlpha, 'env.mts'), 'utf8')).toBe(
      'export const env = true\n',
    )
    expect(realpathSync(configThroughAlpha).split(path.sep)).not.toContain('node_modules')

    expect(readFileSync(path.join(backlink, 'pg', 'index.js'), 'utf8')).toBe(
      'module.exports = {}\n',
    )
  })

  it('relocates external ts-shared workspace packages the same way', () => {
    const { backendDir, pnpmRoot, prodDir } = makeFixture()

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    const relocated = path.join(prodDir, 'workspace-packages', UTILS_STORE, '@ts-shared', 'utils')
    expect(readFileSync(path.join(relocated, 'strings.mts'), 'utf8')).toBe(
      'export const strings = true\n',
    )
    const original = path.join(pnpmRoot, UTILS_STORE, 'node_modules', '@ts-shared', 'utils')
    expect(lstatSync(original).isSymbolicLink()).toBe(true)
  })

  it('leaves npm packages in the virtual store untouched', () => {
    const { backendDir, pnpmRoot, prodDir } = makeFixture()

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    const pgContent = path.join(pnpmRoot, PG_STORE, 'node_modules', 'pg')
    const stats = lstatSync(pgContent)
    expect(stats.isDirectory()).toBe(true)
    expect(stats.isSymbolicLink()).toBe(false)
    expect(existsSync(path.join(prodDir, 'workspace-packages', PG_STORE))).toBe(false)
  })

  it('is idempotent across repeated runs', () => {
    const { alphaContent, backendDir, prodDir } = makeFixture()

    restoreDeployedWorkspacePackages({ backendDir, prodDir })
    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    const relocated = path.join(prodDir, 'workspace-packages', ALPHA_STORE, '@services', 'alpha')
    expect(readFileSync(path.join(relocated, 'index.mts'), 'utf8')).toBe(
      'export const alpha = true\n',
    )
    expect(lstatSync(alphaContent).isSymbolicLink()).toBe(true)
    expect(existsSync(path.join(relocated, '@services'))).toBe(false)
  })

  it('relocates peer-variant store entries independently', () => {
    const { backendDir, pnpmRoot, prodDir } = makeFixture()
    const peerStore = `${ALPHA_STORE}_peerdep@1.0.0`
    const peerContent = path.join(pnpmRoot, peerStore, 'node_modules', '@services', 'alpha')
    mkdirSync(peerContent, { recursive: true })
    writeFileSync(path.join(peerContent, 'index.mts'), 'export const alphaPeer = true\n')

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    const relocatedBase = path.join(
      prodDir,
      'workspace-packages',
      ALPHA_STORE,
      '@services',
      'alpha',
    )
    const relocatedPeer = path.join(prodDir, 'workspace-packages', peerStore, '@services', 'alpha')
    expect(readFileSync(path.join(relocatedBase, 'index.mts'), 'utf8')).toBe(
      'export const alpha = true\n',
    )
    expect(readFileSync(path.join(relocatedPeer, 'index.mts'), 'utf8')).toBe(
      'export const alphaPeer = true\n',
    )
    expect(lstatSync(peerContent).isSymbolicLink()).toBe(true)
  })

  it('skips the .pnpm hoist directory and stray files', () => {
    const { backendDir, pnpmRoot, prodDir } = makeFixture()

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    const hoistDecoy = path.join(pnpmRoot, 'node_modules', '@services', 'alpha')
    expect(lstatSync(hoistDecoy).isDirectory()).toBe(true)
    expect(readFileSync(path.join(hoistDecoy, 'index.mts'), 'utf8')).toBe('hoisted decoy\n')
    expect(existsSync(path.join(prodDir, 'workspace-packages', 'node_modules'))).toBe(false)
  })

  it('merges sibling links into an existing node_modules directory without overwriting it', () => {
    const { alphaContent, backendDir, prodDir } = makeFixture()
    mkdirSync(path.join(alphaContent, 'node_modules', '.bin'), { recursive: true })
    writeFileSync(path.join(alphaContent, 'node_modules', '.bin', 'tool'), '#!/bin/sh\n')
    mkdirSync(path.join(alphaContent, 'node_modules', 'pg'), { recursive: true })
    writeFileSync(
      path.join(alphaContent, 'node_modules', 'pg', 'index.js'),
      'module.exports = "nested"\n',
    )

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    const relocated = path.join(prodDir, 'workspace-packages', ALPHA_STORE, '@services', 'alpha')
    const nested = path.join(relocated, 'node_modules')
    expect(lstatSync(nested).isSymbolicLink()).toBe(false)
    expect(readFileSync(path.join(nested, '.bin', 'tool'), 'utf8')).toBe('#!/bin/sh\n')
    expect(lstatSync(path.join(nested, 'pg')).isSymbolicLink()).toBe(false)
    expect(readFileSync(path.join(nested, 'pg', 'index.js'), 'utf8')).toBe(
      'module.exports = "nested"\n',
    )
    expect(lstatSync(path.join(nested, '@workspace')).isSymbolicLink()).toBe(true)
    expect(readFileSync(path.join(nested, '@workspace', 'config', 'env.mts'), 'utf8')).toBe(
      'export const env = true\n',
    )
  })

  it('merges remaining scoped packages into an existing scope directory', () => {
    const { alphaContent, backendDir, prodDir } = makeFixture()
    mkdirSync(path.join(alphaContent, 'node_modules', '@workspace'), { recursive: true })
    writeFileSync(path.join(alphaContent, 'node_modules', '@workspace', 'keep.txt'), 'keep\n')

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    const nested = path.join(
      prodDir,
      'workspace-packages',
      ALPHA_STORE,
      '@services',
      'alpha',
      'node_modules',
    )
    expect(readFileSync(path.join(nested, '@workspace', 'keep.txt'), 'utf8')).toBe('keep\n')
    expect(lstatSync(path.join(nested, '@workspace', 'config')).isSymbolicLink()).toBe(true)
    expect(readFileSync(path.join(nested, '@workspace', 'config', 'env.mts'), 'utf8')).toBe(
      'export const env = true\n',
    )
  })

  it('leaves existing sibling files and symlinks in place while merging', () => {
    const { alphaContent, backendDir, pnpmRoot, prodDir } = makeFixture()
    mkdirSync(path.join(alphaContent, 'node_modules'), { recursive: true })
    writeFileSync(path.join(alphaContent, 'node_modules', 'pg'), 'nested file\n')
    relativeSymlink(
      path.join(alphaContent, 'node_modules', '@workspace'),
      path.join(pnpmRoot, CONFIG_STORE, 'node_modules', '@workspace'),
    )
    mkdirSync(path.join(alphaContent, 'node_modules', 'notes'), { recursive: true })
    writeFileSync(path.join(pnpmRoot, ALPHA_STORE, 'node_modules', 'notes'), 'not a directory\n')

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    const nested = path.join(
      prodDir,
      'workspace-packages',
      ALPHA_STORE,
      '@services',
      'alpha',
      'node_modules',
    )
    expect(readFileSync(path.join(nested, 'pg'), 'utf8')).toBe('nested file\n')
    expect(lstatSync(path.join(nested, '@workspace')).isSymbolicLink()).toBe(true)
    expect(lstatSync(path.join(nested, 'notes')).isDirectory()).toBe(true)
  })

  it('discovers nested workspace globs', () => {
    const { backendDir, pnpmRoot, prodDir } = makeFixture()
    const pkgDir = path.join(backendDir, 'libs', 'one', 'pkg')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@libs/one-pkg' }))
    writeFileSync(
      path.join(backendDir, 'package.json'),
      JSON.stringify({
        name: '@workspace/backend',
        workspaces: ['services/*', 'libs/*/pkg'],
      }),
    )
    const store = '@libs+one-pkg@file+backend+libs+one+pkg'
    const content = path.join(pnpmRoot, store, 'node_modules', '@libs', 'one-pkg')
    mkdirSync(content, { recursive: true })
    writeFileSync(path.join(content, 'index.mts'), 'export const nested = true\n')

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    expect(
      readFileSync(
        path.join(prodDir, 'workspace-packages', store, '@libs', 'one-pkg', 'index.mts'),
        'utf8',
      ),
    ).toBe('export const nested = true\n')
  })

  it('ignores workspace globs with more than one star in a path segment', () => {
    const { alphaContent, backendDir, prodDir } = makeFixture()
    writeFileSync(
      path.join(backendDir, 'package.json'),
      JSON.stringify({ name: '@workspace/backend', workspaces: ['*services*'] }),
    )

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    expect(lstatSync(alphaContent).isDirectory()).toBe(true)
    expect(existsSync(path.join(prodDir, 'workspace-packages'))).toBe(false)
  })

  it('replaces a stale relocated copy from a previous layout', () => {
    const { backendDir, prodDir } = makeFixture()
    const relocated = path.join(prodDir, 'workspace-packages', ALPHA_STORE, '@services', 'alpha')
    mkdirSync(relocated, { recursive: true })
    writeFileSync(path.join(relocated, 'stale.mts'), 'stale\n')

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    expect(existsSync(path.join(relocated, 'stale.mts'))).toBe(false)
    expect(readFileSync(path.join(relocated, 'index.mts'), 'utf8')).toBe(
      'export const alpha = true\n',
    )
  })

  it('returns without changes when the deploy tree has no .pnpm directory', () => {
    const { backendDir, pnpmRoot, prodDir } = makeFixture()
    rmSync(pnpmRoot, { force: true, recursive: true })

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    expect(existsSync(path.join(prodDir, 'workspace-packages'))).toBe(false)
  })

  it('relocates nothing when the backend manifest has no workspaces field', () => {
    const { alphaContent, backendDir, prodDir } = makeFixture()
    writeFileSync(
      path.join(backendDir, 'package.json'),
      JSON.stringify({ name: '@workspace/backend' }),
    )

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    expect(lstatSync(alphaContent).isDirectory()).toBe(true)
    expect(existsSync(path.join(prodDir, 'workspace-packages'))).toBe(false)
  })

  it('relocates into a custom workspaceRoot', () => {
    const { backendDir, prodDir, root } = makeFixture()
    const workspaceRoot = path.join(root, 'relocated-workspaces')

    restoreDeployedWorkspacePackages({ backendDir, prodDir, workspaceRoot })

    expect(
      readFileSync(
        path.join(workspaceRoot, ALPHA_STORE, '@services', 'alpha', 'index.mts'),
        'utf8',
      ),
    ).toBe('export const alpha = true\n')
    expect(existsSync(path.join(prodDir, 'workspace-packages'))).toBe(false)
  })

  it('skips a virtual-store path that is a file rather than a directory', () => {
    const { backendDir, pnpmRoot, prodDir } = makeFixture()
    const filePath = path.join(pnpmRoot, PG_STORE, 'node_modules', '@services', 'alpha')
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, 'not a directory\n')

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    expect(lstatSync(filePath).isFile()).toBe(true)
  })

  it('leaves a non-directory node_modules backlink in place', () => {
    const { alphaContent, backendDir, prodDir } = makeFixture()
    writeFileSync(path.join(alphaContent, 'node_modules'), 'not a directory\n')

    restoreDeployedWorkspacePackages({ backendDir, prodDir })

    const relocated = path.join(prodDir, 'workspace-packages', ALPHA_STORE, '@services', 'alpha')
    expect(readFileSync(path.join(relocated, 'node_modules'), 'utf8')).toBe('not a directory\n')
  })

  it('throws when prodDir is empty', () => {
    expect(() => restoreDeployedWorkspacePackages({ prodDir: '', backendDir: '/tmp' })).toThrow(
      /prodDir is required/,
    )
  })

  it('throws when backendDir is missing', () => {
    expect(() => restoreDeployedWorkspacePackages({ prodDir: '/tmp/prod' })).toThrow(
      /backendDir is required/,
    )
  })
})

describe('runRestoreDeployedWorkspacePackagesCli', () => {
  it('does nothing when the module is imported', () => {
    const calls: string[] = []

    runRestoreDeployedWorkspacePackagesCli({
      args: [],
      env: {},
      isMain: false,
      restore: (options) => calls.push(String(options?.prodDir)),
    })

    expect(calls).toEqual([])
  })

  it.each([
    [
      ['/prod', '/backend'],
      { PROD_DIR: '/environment', BACKEND_DIR: '/env-backend' },
      { prodDir: '/prod', backendDir: '/backend' },
    ],
    [
      ['/prod'],
      { PROD_DIR: '/environment', BACKEND_DIR: '/env-backend' },
      { prodDir: '/prod', backendDir: '/env-backend' },
    ],
    [
      [],
      { PROD_DIR: '/environment', BACKEND_DIR: '/env-backend' },
      { prodDir: '/environment', backendDir: '/env-backend' },
    ],
  ])('uses argument then environment directory precedence', (args, env, expected) => {
    const calls: object[] = []

    runRestoreDeployedWorkspacePackagesCli({
      args,
      env,
      isMain: true,
      restore: (options) => calls.push(options),
    })

    expect(calls).toEqual([expected])
  })

  it('throws when no directory argument and no PROD_DIR are provided', () => {
    expect(() =>
      runRestoreDeployedWorkspacePackagesCli({
        args: [],
        env: { BACKEND_DIR: '/backend' },
        isMain: true,
        restore: () => undefined,
      }),
    ).toThrow(/PROD_DIR or a directory argument is required/)
  })

  it('throws when no backend directory argument and no BACKEND_DIR are provided', () => {
    expect(() =>
      runRestoreDeployedWorkspacePackagesCli({
        args: ['/prod'],
        env: {},
        isMain: true,
        restore: () => undefined,
      }),
    ).toThrow(/BACKEND_DIR or a backend directory argument is required/)
  })
})
