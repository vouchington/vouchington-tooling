import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { type CaptureCommand, listWorkspaces, reportGlibcVersionRuntime } from './support.mts'
import { type ProvenanceStatus } from './transition.mts'

const componentNames = [
  'lockfile',
  'npm-config',
  'pnpm',
  'pnpmfiles',
  'runtime',
  'workspace-config',
  'workspace-manifests',
] as const
type ComponentName = (typeof componentNames)[number]
type StructuralProvenance = Record<ComponentName, string>
type PersistentMetadataStamp = {
  lastInvocationInstallScripts: boolean
  provenance: StructuralProvenance
  scriptsEnabledInstallSucceeded: boolean
  version: 4
}

function persistentMetadataStampPath() {
  return path.join(process.cwd(), 'node_modules', '.pnpm-install-metadata-health.json')
}

function fail(message: string): never {
  throw new Error(message)
}

function addFingerprintInput(hash: ReturnType<typeof createHash>, label: string, value: string) {
  hash.update(`${label.length}:${label}${value.length}:${value}`)
}

function componentHash(inputs: Array<readonly [string, string]>) {
  const hash = createHash('sha256')
  for (const [label, value] of inputs) addFingerprintInput(hash, label, value)
  return hash.digest('hex')
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

export async function persistentMetadataFingerprintV4(runCapture: CaptureCommand) {
  const workspaces = (await listWorkspaces(runCapture)).toSorted((left, right) =>
    left.path.localeCompare(right.path),
  )
  const pnpmVersion = await runCapture(['--version'])
  if (pnpmVersion.code !== 0)
    fail(
      `pnpm --version failed: ${pnpmVersion.errorOutput?.trim() || pnpmVersion.output.trim() || 'unknown error'}`,
    )

  const files = new Map(
    await Promise.all(
      ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.pnpmfile.cjs', '.pnpmfile.mjs'].map(
        async (filename) =>
          [filename, await optionalFile(path.join(process.cwd(), filename))] as const,
      ),
    ),
  )
  const manifests = await Promise.all(
    workspaces.map(async (workspace) => {
      const filename = path.relative(process.cwd(), path.join(workspace.path, 'package.json'))
      return [filename, await readFile(path.join(workspace.path, 'package.json'), 'utf8')] as const
    }),
  )
  return {
    lockfile: componentHash([['pnpm-lock.yaml', files.get('pnpm-lock.yaml')!]]),
    'npm-config': componentHash([['.npmrc', files.get('.npmrc')!]]),
    pnpm: componentHash([['version', pnpmVersion.output.trim()]]),
    pnpmfiles: componentHash([
      ['.pnpmfile.cjs', files.get('.pnpmfile.cjs')!],
      ['.pnpmfile.mjs', files.get('.pnpmfile.mjs')!],
    ]),
    runtime: componentHash([['identity', runtimePlatformIdentity()]]),
    'workspace-config': componentHash([['pnpm-workspace.yaml', files.get('pnpm-workspace.yaml')!]]),
    'workspace-manifests': componentHash(manifests),
  } satisfies StructuralProvenance
}

function validStamp(value: unknown): value is PersistentMetadataStamp {
  if (typeof value !== 'object' || value === null) return false
  const stamp = value as Partial<PersistentMetadataStamp>
  return (
    stamp.version === 4 &&
    typeof stamp.lastInvocationInstallScripts === 'boolean' &&
    typeof stamp.scriptsEnabledInstallSucceeded === 'boolean' &&
    typeof stamp.provenance === 'object' &&
    stamp.provenance !== null &&
    componentNames.every((name) => typeof stamp.provenance?.[name] === 'string')
  )
}

async function readPersistentMetadataState() {
  try {
    const parsed: unknown = JSON.parse(await readFile(persistentMetadataStampPath(), 'utf8'))
    return validStamp(parsed)
      ? { kind: 'stamp' as const, stamp: parsed }
      : { kind: 'unsafe' as const }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { kind: 'missing' as const }
      : { kind: 'unsafe' as const }
  }
}

async function readPersistentMetadataStamp() {
  const state = await readPersistentMetadataState()
  return state.kind === 'stamp' ? state.stamp : undefined
}

export async function persistentMetadataStatusV4(
  provenance: StructuralProvenance,
): Promise<ProvenanceStatus> {
  const state = await readPersistentMetadataState()
  if (state.kind === 'missing') return { kind: 'absent' }
  if (state.kind === 'unsafe') return { kind: 'unsafe' }
  const { stamp } = state
  const changed = componentNames.filter((name) => stamp.provenance[name] !== provenance[name])
  return changed.length > 0
    ? { kind: 'changed', components: changed }
    : {
        kind: 'matching',
        lastInvocationInstallScripts: stamp.lastInvocationInstallScripts,
        scriptsEnabledInstallSucceeded: stamp.scriptsEnabledInstallSucceeded,
      }
}

export async function writePersistentMetadataStampV4(
  provenance: StructuralProvenance,
  installScripts: boolean,
  resetScriptsEnabledCapability: boolean,
) {
  const existing = await readPersistentMetadataStamp()
  const existingMatches =
    existing && componentNames.every((name) => existing.provenance[name] === provenance[name])
  const stamp: PersistentMetadataStamp = {
    lastInvocationInstallScripts: installScripts,
    provenance,
    scriptsEnabledInstallSucceeded:
      installScripts ||
      (!resetScriptsEnabledCapability &&
        Boolean(existingMatches && existing.scriptsEnabledInstallSucceeded)),
    version: 4,
  }
  const stampPath = persistentMetadataStampPath()
  const directory = path.dirname(stampPath)
  const temporary = `${stampPath}.${process.pid}.tmp`
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(temporary, `${JSON.stringify(stamp)}\n`)
    await rename(temporary, stampPath)
  } finally {
    await rm(temporary, { force: true })
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
