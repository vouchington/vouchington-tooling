import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  expectedNativeFamily,
  mismatchedNativeBinaries,
  nativeBinariesMatchRuntime,
  nativeFamilyFromMagic,
  repairedNativeBinariesMatchRuntime,
} from './native-health.mts'

const dirs: string[] = []
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02])
const MACHO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe])
const PE = Buffer.from([0x4d, 0x5a, 0x90, 0x00])

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'native-health-'))
  dirs.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

describe('native binary health', () => {
  it('classifies ELF, Mach-O, and PE magics', async () => {
    expect(nativeFamilyFromMagic(ELF)).toBe('elf')
    expect(nativeFamilyFromMagic(MACHO)).toBe('macho')
    expect(nativeFamilyFromMagic(PE)).toBe('pe')
    expect(nativeFamilyFromMagic(Buffer.from('#!/b'))).toBeUndefined()
    expect(nativeFamilyFromMagic(Buffer.alloc(1))).toBeUndefined()
    expect(nativeFamilyFromMagic(Buffer.from([0xfe, 0xed, 0xfa, 0xcf]))).toBe('macho')
    expect(nativeFamilyFromMagic(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))).toBe('macho')
    expect(expectedNativeFamily('linux')).toBe('elf')
    expect(expectedNativeFamily('darwin')).toBe('macho')
    expect(expectedNativeFamily('win32')).toBe('pe')
    expect(expectedNativeFamily('aix')).toBeUndefined()
    await expect(repairedNativeBinariesMatchRuntime([], 'aix')).resolves.toBe(true)
  })

  it('treats a missing or non-directory node_modules as healthy', async () => {
    const root = await makeRoot()
    await expect(nativeBinariesMatchRuntime(root, 'linux')).resolves.toBe(true)
    await writeFile(join(root, 'node_modules'), 'not a directory\n')
    await expect(nativeBinariesMatchRuntime(root, 'linux')).resolves.toBe(true)
  })

  it('ignores JS bins, empty files, and matches same-platform natives', async () => {
    const root = await makeRoot()
    const store = join(root, 'node_modules', '.pnpm', 'native@1.0.0', 'node_modules', 'native')
    await mkdir(store, { recursive: true })
    await writeFile(join(store, 'cli.bin'), '#!/usr/bin/env node\n')
    await writeFile(join(store, 'empty.node'), '')
    await writeFile(join(store, 'addon.node'), process.platform === 'darwin' ? MACHO : ELF)
    await expect(nativeBinariesMatchRuntime(root)).resolves.toBe(true)
    await expect(nativeBinariesMatchRuntime(root, 'win32')).resolves.toBe(false)
    await writeFile(join(store, 'addon.node'), PE)
    await expect(nativeBinariesMatchRuntime(root, 'win32')).resolves.toBe(true)
  })

  it('rejects leftover natives that do not match this runtime', async () => {
    const root = await makeRoot()
    const store = join(root, 'node_modules', '.pnpm', 'native@1.0.0', 'node_modules', 'native')
    await mkdir(store, { recursive: true })
    await writeFile(join(store, 'addon.node'), process.platform === 'darwin' ? ELF : MACHO)
    await expect(nativeBinariesMatchRuntime(root)).resolves.toBe(false)
  })

  it('ignores mismatches owned by packages excluded from this platform', async () => {
    const root = await makeRoot()
    const excluded = join(
      root,
      'node_modules',
      '.pnpm',
      'darwin-only@1.0.0',
      'node_modules',
      'darwin-only',
    )
    const generic = join(root, 'node_modules', '.pnpm', 'generic@1.0.0', 'node_modules', 'generic')
    const compatible = join(root, 'node_modules', '.pnpm', 'linux@1.0.0', 'node_modules', 'linux')
    const any = join(root, 'node_modules', '.pnpm', 'any@1.0.0', 'node_modules', 'any')
    const negated = join(root, 'node_modules', '.pnpm', 'negated@1.0.0', 'node_modules', 'negated')
    const mixed = join(root, 'node_modules', '.pnpm', 'mixed@1.0.0', 'node_modules', 'mixed')
    const stringValue = join(
      root,
      'node_modules',
      '.pnpm',
      'string@1.0.0',
      'node_modules',
      'string',
    )
    await Promise.all([
      mkdir(excluded, { recursive: true }),
      mkdir(generic, { recursive: true }),
      mkdir(compatible, { recursive: true }),
      mkdir(any, { recursive: true }),
      mkdir(negated, { recursive: true }),
      mkdir(mixed, { recursive: true }),
      mkdir(stringValue, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(excluded, 'package.json'), '{"os":["darwin"]}'),
      writeFile(join(excluded, 'addon.node'), MACHO),
      writeFile(join(generic, 'package.json'), '{}'),
      writeFile(join(generic, 'addon.node'), MACHO),
      writeFile(join(compatible, 'package.json'), '{"os":["linux"]}'),
      writeFile(join(compatible, 'addon.node'), MACHO),
      writeFile(join(any, 'package.json'), '{"os":["any"]}'),
      writeFile(join(any, 'addon.node'), MACHO),
      writeFile(join(negated, 'package.json'), '{"os":["any","!linux"]}'),
      writeFile(join(negated, 'addon.node'), MACHO),
      writeFile(join(mixed, 'package.json'), '{"os":["any","!darwin"]}'),
      writeFile(join(mixed, 'addon.node'), MACHO),
      writeFile(join(stringValue, 'package.json'), '{"os":"darwin"}'),
      writeFile(join(stringValue, 'addon.node'), MACHO),
    ])
    await expect(mismatchedNativeBinaries(root, 'linux')).resolves.toEqual(
      expect.arrayContaining([join(generic, 'addon.node'), join(compatible, 'addon.node')]),
    )
    await expect(mismatchedNativeBinaries(root, 'linux')).resolves.not.toContain(
      join(excluded, 'addon.node'),
    )
    await expect(mismatchedNativeBinaries(root, 'linux')).resolves.toEqual(
      expect.arrayContaining([join(any, 'addon.node')]),
    )
    await expect(mismatchedNativeBinaries(root, 'linux')).resolves.not.toContain(
      join(negated, 'addon.node'),
    )
    await expect(mismatchedNativeBinaries(root, 'linux')).resolves.not.toContain(
      join(mixed, 'addon.node'),
    )
    await expect(mismatchedNativeBinaries(root, 'linux')).resolves.not.toContain(
      join(stringValue, 'addon.node'),
    )
  })

  it('uses the package owner instead of nested package metadata', async () => {
    const root = await makeRoot()
    const store = join(root, 'node_modules', '.pnpm', 'native@1.0.0', 'node_modules', 'native')
    await mkdir(store, { recursive: true })
    await mkdir(join(store, 'tools'), { recursive: true })
    await Promise.all([
      writeFile(join(store, 'package.json'), '{"os":["darwin"]}'),
      writeFile(join(store, 'tools', 'package.json'), '{"os":["linux"]}'),
      writeFile(join(store, 'tools', 'addon.node'), MACHO),
    ])
    await expect(mismatchedNativeBinaries(root, 'linux')).resolves.toEqual([])
  })

  it('uses package metadata from ordinary node_modules layouts', async () => {
    const root = await makeRoot()
    const packageDir = join(root, 'node_modules', 'darwin-only')
    await mkdir(packageDir, { recursive: true })
    await Promise.all([
      writeFile(join(packageDir, 'package.json'), '{"os":["darwin"]}'),
      writeFile(join(packageDir, 'addon.node'), MACHO),
    ])
    await expect(mismatchedNativeBinaries(root, 'linux')).resolves.toEqual([])
  })

  it('reads each mismatched package owner once', async () => {
    const root = await makeRoot()
    const store = join(root, 'node_modules', '.pnpm', 'native@1.0.0', 'node_modules', 'native')
    await mkdir(store, { recursive: true })
    await Promise.all([
      writeFile(join(store, 'first.node'), MACHO),
      writeFile(join(store, 'second.node'), MACHO),
    ])
    const owners: string[] = []
    await expect(
      mismatchedNativeBinaries(root, 'linux', async (owner) => {
        owners.push(owner)
        return false
      }),
    ).resolves.toHaveLength(2)
    expect(owners).toEqual([store])
  })

  it('skips dangling native paths and unknown platforms', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await symlink('/missing-native-health', join(root, 'node_modules', 'gone.node'))
    await expect(nativeBinariesMatchRuntime(root, 'linux')).resolves.toBe(true)
    await writeFile(join(root, 'node_modules', 'stale.node'), ELF)
    await expect(nativeBinariesMatchRuntime(root, 'linux')).resolves.toBe(true)
    await expect(nativeBinariesMatchRuntime(root, 'darwin')).resolves.toBe(false)
    await writeFile(join(root, 'node_modules', '.pnpm'), 'not a directory\n')
    await expect(nativeBinariesMatchRuntime(root, 'darwin')).resolves.toBe(false)
    await expect(nativeBinariesMatchRuntime(root, 'aix')).resolves.toBe(true)
  })

  it('rethrows non-ENOENT errors while inspecting natives', async () => {
    const root = await makeRoot()
    const directory = join(root, 'node_modules', 'real-dir')
    await mkdir(directory, { recursive: true })
    await symlink(directory, join(root, 'node_modules', 'addon.node'))
    await expect(nativeBinariesMatchRuntime(root, 'linux')).rejects.toMatchObject({
      code: 'EISDIR',
    })
  })
})
