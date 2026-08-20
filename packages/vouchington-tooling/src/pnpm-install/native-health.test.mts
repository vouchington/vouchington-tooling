import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  expectedNativeFamily,
  nativeBinariesMatchRuntime,
  nativeFamilyFromMagic,
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
  it('classifies ELF, Mach-O, and PE magics', () => {
    expect(nativeFamilyFromMagic(ELF)).toBe('elf')
    expect(nativeFamilyFromMagic(MACHO)).toBe('macho')
    expect(nativeFamilyFromMagic(PE)).toBe('pe')
    expect(nativeFamilyFromMagic(Buffer.from('#!/b'))).toBeUndefined()
    expect(expectedNativeFamily('linux')).toBe('elf')
    expect(expectedNativeFamily('darwin')).toBe('macho')
    expect(expectedNativeFamily('win32')).toBe('pe')
    expect(expectedNativeFamily('aix')).toBeUndefined()
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

  it('skips dangling native paths and unknown platforms', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await symlink('/missing-native-health', join(root, 'node_modules', 'gone.node'))
    await writeFile(join(root, 'node_modules', '.pnpm'), 'not a directory\n')
    await writeFile(join(root, 'node_modules', 'stale.node'), ELF)
    await expect(nativeBinariesMatchRuntime(root, 'linux')).resolves.toBe(true)
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
