import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

type PlatformKey = 'cpu' | 'libc' | 'os'
const PLATFORM_KEYS: readonly PlatformKey[] = ['os', 'cpu', 'libc']

export interface PnpmLicenseAuditWorkspace {
  readonly cleanup: () => void
  readonly cwd: string
}

function parseYamlObject(source: string, path: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = parseYaml(source)
  } catch (error) {
    throw new Error(`failed to parse ${path}: ${String(error)}`, { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`expected ${path} to contain a YAML object`)
  }
  return parsed as Record<string, unknown>
}

function getStringList(value: unknown, path: string): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`expected ${path} to be a string or an array of strings`)
  }
  return value
}

export function renderPnpmLicenseAuditWorkspace(
  lockfileSource: string,
  workspaceSource: string,
  paths: { lockfile: string; workspace: string },
): string {
  const lockfile = parseYamlObject(lockfileSource, paths.lockfile)
  const workspace = parseYamlObject(workspaceSource, paths.workspace)
  const packages = lockfile.packages
  if (typeof packages !== 'object' || packages === null || Array.isArray(packages)) {
    throw new Error(`expected ${paths.lockfile} to contain a packages object`)
  }

  const supportedArchitectures: Record<PlatformKey, string[]> = {
    cpu: ['current'],
    libc: ['current'],
    os: ['current'],
  }
  for (const key of PLATFORM_KEYS) {
    const values = new Set<string>()
    for (const snapshot of Object.values(packages as Record<string, unknown>)) {
      if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) continue
      const value = (snapshot as Record<string, unknown>)[key]
      if (value === undefined) continue
      for (const platform of getStringList(value, `${paths.lockfile} packages.*.${key}`)) {
        values.add(platform)
      }
    }
    supportedArchitectures[key].push(...[...values].filter((value) => value !== 'current').sort())
  }
  return stringifyYaml({ ...workspace, packages: [], supportedArchitectures })
}

export function preparePnpmLicenseAuditWorkspace(
  repoRoot: string,
  lockfileSource: string,
  workspaceSource: string,
): PnpmLicenseAuditWorkspace {
  const auditRoot = mkdtempSync(join(tmpdir(), 'dependency-license-audit-'))
  try {
    for (const filename of ['package.json', 'pnpm-lock.yaml']) {
      copyFileSync(join(repoRoot, filename), join(auditRoot, filename))
    }
    const npmrc = join(repoRoot, '.npmrc')
    if (existsSync(npmrc)) copyFileSync(npmrc, join(auditRoot, '.npmrc'))
    writeFileSync(
      join(auditRoot, 'pnpm-workspace.yaml'),
      renderPnpmLicenseAuditWorkspace(lockfileSource, workspaceSource, {
        lockfile: join(repoRoot, 'pnpm-lock.yaml'),
        workspace: join(repoRoot, 'pnpm-workspace.yaml'),
      }),
      'utf8',
    )
  } catch (error) {
    rmSync(auditRoot, { force: true, recursive: true })
    throw error
  }
  return {
    cwd: auditRoot,
    cleanup: () => rmSync(auditRoot, { force: true, recursive: true }),
  }
}
