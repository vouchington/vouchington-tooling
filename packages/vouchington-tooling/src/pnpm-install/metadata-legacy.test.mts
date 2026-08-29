import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  persistentMetadataFingerprint,
  persistentMetadataMatches,
  writePersistentMetadataStamp,
} from './metadata-legacy.mts'
import { reportGlibcVersionRuntime } from './support.mts'

const roots: string[] = []
const previousCwd = process.cwd()

afterEach(async () => {
  process.chdir(previousCwd)
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

function add(hash: ReturnType<typeof createHash>, label: string, value: string) {
  hash.update(`${label.length}:${label}${value.length}:${value}`)
}

function expectedFingerprint(
  installScripts: boolean,
  manifests: Array<{ path: string; contents: string }>,
) {
  const glibc = reportGlibcVersionRuntime(process.report?.getReport())
  const hash = createHash('sha256')
  add(
    hash,
    'runtime',
    JSON.stringify({
      arch: process.arch,
      glibc,
      modules: process.versions.modules,
      node: process.version,
      npmConfigArch: process.env.npm_config_arch ?? '',
      npmConfigLibc: process.env.npm_config_libc ?? '',
      npmConfigPlatform: process.env.npm_config_platform ?? '',
      platform: process.platform,
    }),
  )
  add(hash, 'pnpm', '11.0.0')
  add(hash, 'installScripts', String(installScripts))
  for (const filename of [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    '.pnpmfile.cjs',
    '.pnpmfile.mjs',
  ])
    add(hash, filename, filename === 'pnpm-lock.yaml' ? 'lock\n' : '')
  for (const manifest of manifests.toSorted((left, right) => left.path.localeCompare(right.path)))
    add(hash, relative(process.cwd(), join(manifest.path, 'package.json')), manifest.contents)
  return hash.digest('hex')
}

describe('legacy persistent metadata API', () => {
  it('preserves the v3 fingerprint inputs, boolean matching, and atomic stamp format', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pnpm-metadata-legacy-'))
    roots.push(root)
    const packageJson = '{"name":"root"}\n'
    const dependency = join(root, 'dependency')
    const dependencyPackageJson = '{"name":"dependency"}\n'
    await Promise.all([
      writeFile(join(root, 'package.json'), packageJson),
      writeFile(join(root, 'pnpm-lock.yaml'), 'lock\n'),
      mkdir(dependency),
    ])
    await writeFile(join(dependency, 'package.json'), dependencyPackageJson)
    process.chdir(root)
    const capture = async (args: string[]) =>
      args[0] === '--version'
        ? { code: 0, output: '11.0.0\n' }
        : {
            code: 0,
            output: JSON.stringify([
              { name: 'root', path: root },
              { name: 'dependency', path: dependency },
            ]),
          }
    const enabled = await persistentMetadataFingerprint(capture, true)
    const disabled = await persistentMetadataFingerprint(capture, false)
    const manifests = [
      { contents: dependencyPackageJson, path: dependency },
      { contents: packageJson, path: root },
    ]
    expect(enabled).toBe(expectedFingerprint(true, manifests))
    expect(disabled).toBe(expectedFingerprint(false, manifests))
    expect(enabled).not.toBe(disabled)
    expect(await persistentMetadataMatches(enabled)).toBe(false)
    await writePersistentMetadataStamp(enabled)
    expect(
      await readFile(join(root, 'node_modules', '.pnpm-install-metadata-health.json'), 'utf8'),
    ).toBe(`${JSON.stringify({ fingerprint: enabled, version: 3 })}\n`)
    expect(await persistentMetadataMatches(enabled)).toBe(true)
    expect(await persistentMetadataMatches(disabled)).toBe(false)
  })

  it('returns false for malformed stamps and preserves v3 failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pnpm-metadata-legacy-error-'))
    roots.push(root)
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await writeFile(join(root, 'node_modules', '.pnpm-install-metadata-health.json'), '{')
    process.chdir(root)
    expect(await persistentMetadataMatches('fingerprint')).toBe(false)
    await expect(
      persistentMetadataFingerprint(
        async (args) =>
          args[0] === '--version'
            ? { code: 1, errorOutput: 'nope', output: '' }
            : { code: 0, output: JSON.stringify([{ name: 'root', path: root }]) },
        true,
      ),
    ).rejects.toThrow('pnpm --version failed: nope')
    await expect(
      persistentMetadataFingerprint(
        async (args) =>
          args[0] === '--version'
            ? { code: 1, output: 'stdout-only' }
            : { code: 0, output: JSON.stringify([{ name: 'root', path: root }]) },
        true,
      ),
    ).rejects.toThrow('pnpm --version failed: stdout-only')
    await expect(
      persistentMetadataFingerprint(
        async (args) =>
          args[0] === '--version'
            ? { code: 1, output: '' }
            : { code: 0, output: JSON.stringify([{ name: 'root', path: root }]) },
        true,
      ),
    ).rejects.toThrow('pnpm --version failed: unknown error')

    await mkdir(join(root, 'pnpm-lock.yaml'))
    await expect(
      persistentMetadataFingerprint(
        async (args) =>
          args[0] === '--version'
            ? { code: 0, output: '11.0.0\n' }
            : { code: 0, output: JSON.stringify([{ name: 'root', path: root }]) },
        true,
      ),
    ).rejects.toMatchObject({ code: 'EISDIR' })
  })
})
