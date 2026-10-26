import picomatch from 'picomatch'

import { staleEntries } from './entries.mts'
import { flattenBraceGlobs, isManifestPath, manifestGlob, sameSet } from './globs.mts'
import type { RegistryFiles } from './load.mts'

export interface RegistryNames {
  /** Display name of the syncpack config, used in messages. */
  syncpackConfig: string
  /** Display name of the pnpm workspace file, used in messages. */
  workspaceFile: string
  /** Path-filter group that must reach every manifest. */
  toolingGroup: string
  /** Glob in the tooling group that only triggers CI and does not register a manifest. */
  triggerOnlyGlob: string
  /** Prefix of path-filter groups that mirror a primary group. */
  runtimePrefix: string
}

function matchesAny(path: string, globs: readonly string[]): boolean {
  return picomatch.isMatch(path, [...globs])
}

function runtimeViolations(
  runtime: Record<string, string[]>,
  primary: Record<string, string[]>,
  prefix: string,
): string[] {
  const violations: string[] = []
  for (const [name, runtimeGlobs] of Object.entries(runtime)) {
    const primaryGlobs = primary[name]
    if (!Array.isArray(primaryGlobs)) {
      violations.push(`${prefix}${name} has no primary CI path-filter group`)
    }
    const positive = flattenBraceGlobs(runtimeGlobs.filter((glob) => !glob.startsWith('!')))
    if (!sameSet(positive, flattenBraceGlobs(primaryGlobs ?? []))) {
      violations.push(`${prefix}${name} positive path filters differ from its primary group`)
    }
  }
  return violations
}

/** Validates the package registries against the tracked `package.json` manifests. */
export function checkRegistries(
  trackedFiles: readonly string[],
  files: RegistryFiles,
  names: RegistryNames,
): string[] {
  const manifests = trackedFiles.filter(isManifestPath)
  const { syncpackSource: sourceGlobs, workspacePackages } = files
  const primary: Record<string, string[]> = {}
  const runtime: Record<string, string[]> = {}
  for (const [name, globs] of Object.entries(files.pathFilters)) {
    if (name.startsWith(names.runtimePrefix))
      runtime[name.slice(names.runtimePrefix.length)] = globs
    else primary[name] = globs
  }
  const primaryEntries = Object.entries(primary).flatMap(([name, globs]) =>
    name === names.toolingGroup ? globs.filter((glob) => glob !== names.triggerOnlyGlob) : globs,
  )
  const violations: string[] = []
  const record = (name: string, paths: string[]) => {
    if (paths.length > 0) violations.push(`${name}: ${paths.join(', ')}`)
  }
  const inWorkspace = (manifest: string) =>
    workspacePackages.some((pattern) => picomatch.isMatch(manifest, manifestGlob(pattern)))

  if (sourceGlobs.length === 0) violations.push(`${names.syncpackConfig} source must not be empty`)
  record(
    `tracked package manifests missing from ${names.syncpackConfig} source`,
    manifests.filter((manifest) => !matchesAny(manifest, sourceGlobs)),
  )
  const source = staleEntries(sourceGlobs, manifests)
  record(`stale fixed ${names.syncpackConfig} source entries`, source.stale)
  record(`unmatched wildcard ${names.syncpackConfig} source entries`, source.unmatched)
  record(
    'tracked package manifests missing from a real CI path-filter group',
    manifests.filter((manifest) => !matchesAny(manifest, primaryEntries)),
  )
  const ci = staleEntries(primaryEntries, manifests, isManifestPath)
  record('stale fixed CI path-filter manifest entries', ci.stale)
  record('unmatched wildcard CI path-filter manifest entries', ci.unmatched)
  record(
    `unmatched ${names.workspaceFile} package globs`,
    workspacePackages.filter(
      (pattern) =>
        !manifests.some((manifest) => picomatch.isMatch(manifest, manifestGlob(pattern))),
    ),
  )
  record(
    `negated ${names.workspaceFile} package globs need complete-set semantics`,
    workspacePackages.filter((pattern) => pattern.startsWith('!')),
  )
  record(
    `non-root tracked package manifests missing from ${names.workspaceFile}`,
    manifests.filter((manifest) => manifest !== 'package.json' && !inWorkspace(manifest)),
  )
  violations.push(...runtimeViolations(runtime, primary, names.runtimePrefix))

  const toolingGlobs = primary[names.toolingGroup] ?? []
  record(
    `wildcard pnpm workspace globs unreachable from ${names.toolingGroup} CI`,
    workspacePackages.filter(
      (pattern) => pattern.includes('*') && !matchesAny(manifestGlob(pattern), toolingGlobs),
    ),
  )
  record(
    `tracked package manifests unreachable from ${names.toolingGroup} CI`,
    manifests.filter((manifest) => !matchesAny(manifest, toolingGlobs)),
  )
  return violations
}
