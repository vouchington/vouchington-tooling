import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  packageNameFromPnpmLockKey,
  pnpmLockPackageKeyMatchesSelector,
} from '../pnpm-install/index.mts'
import type { SharedContext } from '../shared-context/index.mts'
import type { ResolvedWorkspaceGatesOptions } from './options.mts'
import { loadYaml, type AnyObj } from './yaml-loader.mts'

const PACKAGE_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

async function collectManifestDependencyNames(
  ctx: SharedContext,
  errors: string[],
): Promise<Set<string>> {
  const names = new Set<string>()
  const packageJsonFiles = ctx.trackedFiles.filter(
    (file) => file === 'package.json' || file.endsWith('/package.json'),
  )

  for (const relPath of packageJsonFiles) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(join(ctx.repoRoot, relPath), 'utf8'))
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as NodeJS.ErrnoException).code)
          : undefined
      const reason = code === undefined ? 'parse' : 'read'
      errors.push(`::error file=${relPath}::${relPath}: failed to ${reason} package.json`)
      continue
    }

    if (typeof parsed !== 'object' || parsed === null) continue
    for (const field of PACKAGE_DEPENDENCY_FIELDS) {
      const dependencies = (parsed as AnyObj)[field]
      if (
        typeof dependencies !== 'object' ||
        dependencies === null ||
        Array.isArray(dependencies)
      ) {
        continue
      }
      for (const name of Object.keys(dependencies as AnyObj)) names.add(name)
    }
  }

  return names
}

async function collectLockfilePackageKeys(
  ctx: SharedContext,
  errors: string[],
  lockfilePath: string,
): Promise<string[]> {
  if (!ctx.trackedFileSet.has(lockfilePath)) return []

  const lockfile = await loadYaml(ctx.repoRoot, lockfilePath, errors)
  const packages = lockfile?.['packages']
  if (typeof packages !== 'object' || packages === null || Array.isArray(packages)) return []

  return Object.keys(packages as AnyObj)
}

function collectLockfilePackageNames(packageKeys: readonly string[]): Set<string> {
  const names = new Set<string>()
  for (const key of packageKeys) {
    const packageName = packageNameFromPnpmLockKey(key)
    if (packageName) names.add(packageName)
  }
  return names
}

export async function checkActiveFirstPartyGraph(
  ctx: SharedContext,
  errors: string[],
  options: ResolvedWorkspaceGatesOptions,
): Promise<void> {
  const registryNames = new Set(options.firstPartyNames)
  const manifestDependencyNames = await collectManifestDependencyNames(ctx, errors)
  const lockfilePackageKeys = await collectLockfilePackageKeys(ctx, errors, options.lockfilePath)
  const lockfilePackageNames = collectLockfilePackageNames(lockfilePackageKeys)
  const activeNames = new Set([...manifestDependencyNames, ...lockfilePackageNames])

  if (options.scopedPrefixes.length > 0) {
    for (const name of activeNames) {
      if (
        options.scopedPrefixes.some((prefix) => name.startsWith(prefix)) &&
        !registryNames.has(name)
      ) {
        errors.push(
          `::error::active first-party package "${name}" appears in tracked package manifests or ${options.lockfilePath} but is missing from the ${options.firstPartyRegistryLabel}`,
        )
      }
    }
  }

  for (const name of registryNames) {
    if (!activeNames.has(name)) {
      errors.push(
        `::error::first-party package "${name}" is registered but absent from tracked package manifests and ${options.lockfilePath}`,
      )
    }
  }
}

export async function checkTemporaryReleaseAgeSelectorsInLockfile(
  ctx: SharedContext,
  errors: string[],
  temporarySelectors: readonly string[],
  lockfilePath: string,
): Promise<void> {
  const lockfilePackageKeys = await collectLockfilePackageKeys(ctx, errors, lockfilePath)
  for (const selector of temporarySelectors) {
    if (!lockfilePackageKeys.some((key) => pnpmLockPackageKeyMatchesSelector(key, selector))) {
      errors.push(
        `::error file=${lockfilePath}::temporary release-age exemption "${selector}" is absent from tracked ${lockfilePath} packages`,
      )
    }
  }
}
