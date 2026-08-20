import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { type CaptureCommand, listWorkspaces, reportGlibcVersionRuntime } from './support.mts'

type PersistentMetadataStamp = { fingerprint: string; version: 2 }

function persistentMetadataStampPath() {
  return path.join(process.cwd(), 'node_modules', '.pnpm-install-metadata-health.json')
}

function fail(message: string): never {
  throw new Error(message)
}

function addFingerprintInput(hash: ReturnType<typeof createHash>, label: string, value: string) {
  hash.update(`${label.length}:${label}${value.length}:${value}`)
}

async function optionalFile(pathname: string) {
  try {
    return await readFile(pathname, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

function runtimePlatformIdentity() {
  const report = process.report?.getReport()
  return JSON.stringify({
    arch: process.arch,
    glibc: reportGlibcVersionRuntime(report),
    modules: process.versions.modules,
    node: process.version,
    npmConfigArch: process.env.npm_config_arch ?? '',
    npmConfigLibc: process.env.npm_config_libc ?? '',
    npmConfigPlatform: process.env.npm_config_platform ?? '',
    platform: process.platform,
  })
}

export async function persistentMetadataFingerprint(
  runCapture: CaptureCommand,
  installScripts: boolean,
) {
  const workspaces = (await listWorkspaces(runCapture)).toSorted((left, right) =>
    left.path.localeCompare(right.path),
  )
  const pnpmVersion = await runCapture(['--version'])
  if (pnpmVersion.code !== 0)
    fail(
      `pnpm --version failed: ${pnpmVersion.errorOutput?.trim() || pnpmVersion.output.trim() || 'unknown error'}`,
    )

  const hash = createHash('sha256')
  addFingerprintInput(hash, 'runtime', runtimePlatformIdentity())
  addFingerprintInput(hash, 'pnpm', pnpmVersion.output.trim())
  addFingerprintInput(hash, 'installScripts', String(installScripts))
  for (const filename of [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    '.pnpmfile.cjs',
    '.pnpmfile.mjs',
  ])
    addFingerprintInput(hash, filename, await optionalFile(path.join(process.cwd(), filename)))
  for (const workspace of workspaces)
    addFingerprintInput(
      hash,
      path.relative(process.cwd(), path.join(workspace.path, 'package.json')),
      await readFile(path.join(workspace.path, 'package.json'), 'utf8'),
    )
  return hash.digest('hex')
}

export async function persistentMetadataMatches(fingerprint: string) {
  try {
    const stamp = JSON.parse(
      await readFile(persistentMetadataStampPath(), 'utf8'),
    ) as PersistentMetadataStamp
    return stamp.version === 2 && stamp.fingerprint === fingerprint
  } catch {
    return false
  }
}

export async function persistentDependencyTreeIsCold() {
  try {
    await stat(path.dirname(persistentMetadataStampPath()))
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    /* v8 ignore next -- non-ENOENT stat failures are host-specific */
    throw error
  }
}

export async function writePersistentMetadataStamp(fingerprint: string) {
  const stampPath = persistentMetadataStampPath()
  const directory = path.dirname(stampPath)
  const temporary = `${stampPath}.${process.pid}.tmp`
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(
      temporary,
      `${JSON.stringify({ fingerprint, version: 2 } satisfies PersistentMetadataStamp)}\n`,
    )
    await rename(temporary, stampPath)
  } finally {
    await rm(temporary, { force: true })
  }
}
