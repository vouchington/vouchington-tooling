import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isMap, parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { parsePnpmLockfileGraphDocument } from '../pnpm-lockfile.mts'

type PlatformKey = 'cpu' | 'libc' | 'os'
const PLATFORM_KEYS: readonly PlatformKey[] = ['os', 'cpu', 'libc']

export interface PnpmLicenseAuditWorkspace {
  readonly cleanup: () => void
  readonly cwd: string
}

/** The rendered `pnpm-lock.yaml` and `pnpm-workspace.yaml` of a license audit workspace. */
export interface PnpmLicenseAuditFiles {
  readonly lockfile: string
  readonly workspace: string
}

function parseYamlSource<T>(parse: () => T, path: string): T {
  try {
    return parse()
  } catch (error) {
    throw new Error(`failed to parse ${path}: ${String(error)}`, { cause: error })
  }
}

function assertYamlObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected ${path} to contain a YAML object`)
  }
  return value as Record<string, unknown>
}

function getStringList(value: unknown, path: string): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`expected ${path} to be a string or an array of strings`)
  }
  return value
}

function collectSupportedArchitectures(
  packages: Record<string, unknown>,
  lockfilePath: string,
): Record<PlatformKey, string[]> {
  const supportedArchitectures: Record<PlatformKey, string[]> = {
    cpu: ['current'],
    libc: ['current'],
    os: ['current'],
  }
  for (const key of PLATFORM_KEYS) {
    const values = new Set<string>()
    for (const snapshot of Object.values(packages)) {
      if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) continue
      const value = (snapshot as Record<string, unknown>)[key]
      if (value === undefined) continue
      for (const platform of getStringList(value, `${lockfilePath} packages.*.${key}`)) {
        values.add(platform)
      }
    }
    supportedArchitectures[key].push(...[...values].filter((value) => value !== 'current').sort())
  }
  return supportedArchitectures
}

/**
 * Renders the audit copies of `pnpm-lock.yaml` and `pnpm-workspace.yaml` so `pnpm fetch` downloads
 * every package in the lockfile, including optional ones that don't match the host.
 *
 * The workspace supports every `os`, `cpu`, and `libc` in the lockfile's graph. The lockfile drops
 * every `engines` constraint from the graph because pnpm 12's `fetch` ignores `force` and skips an
 * optional package whose `engines` exclude the running Node.js. That leaves the package's license
 * Unknown. The pnpm 12 env document stays byte-for-byte, since pnpm checks the `packageManager`
 * pin against it.
 */
export function renderPnpmLicenseAuditFiles(
  lockfileSource: string,
  workspaceSource: string,
  paths: { lockfile: string; workspace: string },
): PnpmLicenseAuditFiles {
  const graph = parseYamlSource(
    () => parsePnpmLockfileGraphDocument(lockfileSource),
    paths.lockfile,
  )
  if (!graph) throw new Error(`expected ${paths.lockfile} to contain a YAML object`)
  const lockfile = assertYamlObject(graph.document.toJS(), paths.lockfile)
  const workspace = assertYamlObject(
    parseYamlSource(() => parseYaml(workspaceSource) as unknown, paths.workspace),
    paths.workspace,
  )
  const packageNodes = graph.document.get('packages')
  if (!isMap(packageNodes)) {
    throw new Error(`expected ${paths.lockfile} to contain a packages object`)
  }

  const supportedArchitectures = collectSupportedArchitectures(
    lockfile.packages as Record<string, unknown>,
    paths.lockfile,
  )
  for (const { value } of packageNodes.items) if (isMap(value)) value.delete('engines')
  return {
    lockfile: lockfileSource.slice(0, graph.start) + graph.document.toString({ lineWidth: 0 }),
    workspace: stringifyYaml({ ...workspace, packages: [], supportedArchitectures }),
  }
}

export function preparePnpmLicenseAuditWorkspace(
  repoRoot: string,
  lockfileSource: string,
  workspaceSource: string,
): PnpmLicenseAuditWorkspace {
  const auditRoot = mkdtempSync(join(tmpdir(), 'dependency-license-audit-'))
  try {
    copyFileSync(join(repoRoot, 'package.json'), join(auditRoot, 'package.json'))
    const npmrc = join(repoRoot, '.npmrc')
    if (existsSync(npmrc)) copyFileSync(npmrc, join(auditRoot, '.npmrc'))
    const files = renderPnpmLicenseAuditFiles(lockfileSource, workspaceSource, {
      lockfile: join(repoRoot, 'pnpm-lock.yaml'),
      workspace: join(repoRoot, 'pnpm-workspace.yaml'),
    })
    writeFileSync(join(auditRoot, 'pnpm-lock.yaml'), files.lockfile, 'utf8')
    writeFileSync(join(auditRoot, 'pnpm-workspace.yaml'), files.workspace, 'utf8')
  } catch (error) {
    rmSync(auditRoot, { force: true, recursive: true })
    throw error
  }
  return {
    cwd: auditRoot,
    cleanup: () => rmSync(auditRoot, { force: true, recursive: true }),
  }
}
