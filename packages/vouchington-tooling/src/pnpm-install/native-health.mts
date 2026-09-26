import { glob, open, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { expectedNativeFamily, nativeFamilyFromMagic } from './native-family.mts'

export { expectedNativeFamily, nativeFamilyFromMagic } from './native-family.mts'

async function readMagic(pathname: string) {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(pathname, 'r')
    const buffer = Buffer.alloc(4)
    const { bytesRead } = await handle.read(buffer, 0, 4, 0)
    return bytesRead === 0 ? undefined : buffer.subarray(0, bytesRead)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  } finally {
    await handle?.close()
  }
}

async function searchRoot(nodeModules: string) {
  const pnpmStore = path.join(nodeModules, '.pnpm')
  try {
    const info = await stat(pnpmStore)
    return info.isDirectory() ? pnpmStore : nodeModules
  } catch {
    return nodeModules
  }
}

function excludesPlatform(os: unknown, platform: string) {
  const values = typeof os === 'string' ? [os] : Array.isArray(os) ? os : undefined
  if (values === undefined || !values.every((value) => typeof value === 'string')) return false
  if (values.length === 1 && values[0] === 'any') return false
  if (values.includes(`!${platform}`)) return true
  return values.some((value) => !value.startsWith('!')) && !values.includes(platform)
}

function packageRoot(pathname: string, searchRoot: string) {
  const segments = path.relative(searchRoot, pathname).split(path.sep)
  const nodeModules = segments.lastIndexOf('node_modules')
  const packageStart = nodeModules === -1 ? 0 : nodeModules + 1
  const name = segments[packageStart]
  if (name === undefined || name === '.bin') return undefined
  const packageLength = name.startsWith('@') ? 2 : 1
  if (segments.length <= packageStart + packageLength) return undefined
  return path.join(searchRoot, ...segments.slice(0, packageStart + packageLength))
}

async function packageExcludesPlatform(owner: string, platform: string) {
  try {
    const manifest = JSON.parse(await readFile(path.join(owner, 'package.json'), 'utf8')) as {
      os?: unknown
    }
    return excludesPlatform(manifest.os, platform)
  } catch {
    return false
  }
}

export async function mismatchedNativeBinaries(
  root = process.cwd(),
  platform = process.platform,
  readPackageExclusion = packageExcludesPlatform,
) {
  const expected = expectedNativeFamily(platform)
  if (expected === undefined) return []
  const nodeModules = path.join(root, 'node_modules')
  try {
    const info = await stat(nodeModules)
    if (!info.isDirectory()) return []
  } catch {
    return []
  }

  const cwd = await searchRoot(nodeModules)
  const pattern = cwd === nodeModules ? ['**/*.{node,bin}', '.bin/*.{node,bin}'] : '**/*.{node,bin}'
  const mismatches: Array<{ owner: string | undefined; pathname: string }> = []
  for await (const relative of glob(pattern, { cwd })) {
    const pathname = path.join(cwd, relative)
    const magic = await readMagic(pathname)
    if (magic === undefined) continue
    const family = nativeFamilyFromMagic(magic)
    if (family !== undefined && family !== expected) {
      mismatches.push({ owner: packageRoot(pathname, cwd), pathname })
    }
  }
  const owners = [
    ...new Set(mismatches.flatMap(({ owner }) => (owner === undefined ? [] : [owner]))),
  ]
  const exclusions = new Map<string, boolean>(
    await Promise.all(
      owners.map(async (owner): Promise<[string, boolean]> => [
        owner,
        await readPackageExclusion(owner, platform),
      ]),
    ),
  )
  return mismatches
    .filter(({ owner }) => owner === undefined || !exclusions.get(owner))
    .map(({ pathname }) => pathname)
}

export async function nativeBinariesMatchRuntime(
  root = process.cwd(),
  platform = process.platform,
) {
  return (await mismatchedNativeBinaries(root, platform)).length === 0
}

export async function repairedNativeBinariesMatchRuntime(
  paths: string[],
  platform = process.platform,
) {
  const expected = expectedNativeFamily(platform)
  if (expected === undefined) return true
  for (const pathname of paths) {
    const magic = await readMagic(pathname)
    if (magic === undefined || nativeFamilyFromMagic(magic) !== expected) return false
  }
  return nativeBinariesMatchRuntime()
}
