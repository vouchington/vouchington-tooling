/**
 * Configuration-driven validation for pnpm's `minimumReleaseAgeExclude` list.
 *
 * This module intentionally does not read repository files or parse YAML. A repository-specific
 * adapter can parse its workspace and lockfile once, then pass the resulting values here. Keeping
 * the policy engine pure makes its public contract safe to share with other repositories and keeps
 * private package names, scopes, and documentation out of this package.
 */

const EXACT_PACKAGE_VERSION_SELECTOR =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const CANONICAL_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

import type {
  ReleaseAgeExemptionGroup,
  ReleaseAgePolicyConfig,
  ReleaseAgePolicySnapshot,
} from './release-age-policy-types.mts'

export type {
  ReleaseAgeExemptionGroup,
  ReleaseAgePermanentExemption,
  ReleaseAgePolicyConfig,
  ReleaseAgePolicySnapshot,
} from './release-age-policy-types.mts'

function isCanonicalUtcInstant(value: string): boolean {
  if (!CANONICAL_UTC_INSTANT.test(value)) return false
  const timestamp = Date.parse(value)
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value.replace('Z', '.000Z')
  )
}

/** Returns a flat list of temporary selectors, preserving declaration order. */
export function flattenReleaseAgeSelectors(
  groups: ReadonlyArray<ReleaseAgeExemptionGroup>,
): string[] {
  return groups.flatMap((group) => group.selectors)
}

/**
 * Validates temporary exemption shape without applying repository-specific policy.
 *
 * The returned messages are deliberately path-free so a caller can attach its own CI annotation
 * location. The function reports every independent error rather than throwing on malformed input.
 */
export function validateReleaseAgeExemptionGroups(
  groups: ReadonlyArray<ReleaseAgeExemptionGroup>,
): string[] {
  const errors: string[] = []
  const selectors = new Set<string>()
  for (const group of groups) {
    if (group.selectors.length === 0) {
      errors.push('release-age exemption group must contain at least one exact selector')
    }
    for (const selector of group.selectors) {
      if (!EXACT_PACKAGE_VERSION_SELECTOR.test(selector)) {
        errors.push(`release-age exemption "${selector}" must be an exact package@version selector`)
      }
      if (selectors.has(selector)) errors.push(`duplicate release-age exemption "${selector}"`)
      selectors.add(selector)
    }
    if (group.reason.trim().length === 0) {
      errors.push('release-age exemption group must have a nonblank reason')
    }
    if (!isCanonicalUtcInstant(group.eligibleForRemovalAt)) {
      errors.push(
        'release-age exemption group eligibleForRemovalAt must be a canonical UTC instant (YYYY-MM-DDTHH:mm:ssZ)',
      )
    }
  }
  return errors
}

/** Extracts an npm package name from a pnpm lockfile package key. */
export function packageNameFromPnpmLockKey(key: string): string | null {
  const normalized = key.startsWith('/') ? key.slice(1) : key
  if (normalized.startsWith('@')) {
    const packageSeparator = normalized.indexOf('/', 1)
    if (packageSeparator === -1) return null
    const versionSeparator = normalized.indexOf('@', packageSeparator + 1)
    return versionSeparator === -1 ? null : normalized.slice(0, versionSeparator)
  }
  const versionSeparator = normalized.indexOf('@')
  return versionSeparator === -1 ? null : normalized.slice(0, versionSeparator)
}

/** Tests whether a lockfile key represents an exact package@version selector. */
export function pnpmLockPackageKeyMatchesSelector(key: string, selector: string): boolean {
  const normalized = key.startsWith('/') ? key.slice(1) : key
  return (
    normalized === selector ||
    normalized.startsWith(`${selector}(`) ||
    normalized.startsWith(`${selector}_`)
  )
}

/**
 * Validates registry/workspace/graph consistency for a configured release-age policy.
 *
 * `activePackageNames` should be the union of dependency names discovered in tracked manifests and
 * the lockfile. If `lockfilePackageKeys` is supplied, every temporary selector must match a key;
 * omitting it lets adapters that do not track lockfiles use the shape and registry checks alone.
 */
export function validateReleaseAgePolicy(
  config: ReleaseAgePolicyConfig,
  snapshot: ReleaseAgePolicySnapshot,
): string[] {
  const permanentExemptions = config.permanentExemptions ?? []
  const temporaryGroups = config.temporaryExemptionGroups ?? []
  const prefixes = config.firstPartyPackagePrefixes ?? []
  const activeNames = new Set(snapshot.activePackageNames ?? [])
  const errors = validateReleaseAgeExemptionGroups(temporaryGroups)
  const permanentNames = new Set<string>()

  for (const exemption of permanentExemptions) {
    if (exemption.name.trim().length === 0)
      errors.push('permanent release-age exemption name must be nonblank')
    if (permanentNames.has(exemption.name)) {
      errors.push(`duplicate permanent release-age exemption "${exemption.name}"`)
    }
    permanentNames.add(exemption.name)
    if (exemption.reason.trim().length === 0) {
      errors.push(`permanent release-age exemption "${exemption.name}" must have a nonblank reason`)
    }
  }

  const temporarySelectors = new Set(flattenReleaseAgeSelectors(temporaryGroups))
  const registryNames = new Set([...permanentNames, ...temporarySelectors])
  const workspaceNames = new Set<string>()
  for (const entry of snapshot.workspaceExcludes) {
    if (typeof entry !== 'string') {
      errors.push(`minimumReleaseAgeExclude entry ${JSON.stringify(entry)} must be a string`)
      continue
    }
    if (workspaceNames.has(entry)) {
      errors.push(`minimumReleaseAgeExclude duplicates "${entry}"`)
    }
    workspaceNames.add(entry)
    if (!registryNames.has(entry)) {
      errors.push(`minimumReleaseAgeExclude contains unregistered entry "${entry}"`)
    }
  }

  for (const name of registryNames) {
    if (!workspaceNames.has(name))
      errors.push(
        `registered release-age exemption "${name}" is missing from minimumReleaseAgeExclude`,
      )
  }

  for (const name of activeNames) {
    if (prefixes.some((prefix) => name.startsWith(prefix)) && !permanentNames.has(name)) {
      errors.push(
        `active first-party package "${name}" is missing from permanent release-age exemptions`,
      )
    }
  }
  if (config.requirePermanentExemptionsActive ?? true) {
    for (const name of permanentNames) {
      if (!activeNames.has(name)) {
        errors.push(
          `permanent release-age exemption "${name}" is absent from the active package graph`,
        )
      }
    }
  }

  if (snapshot.lockfilePackageKeys !== undefined) {
    for (const selector of temporarySelectors) {
      if (
        !snapshot.lockfilePackageKeys.some((key) =>
          pnpmLockPackageKeyMatchesSelector(key, selector),
        )
      ) {
        errors.push(
          `temporary release-age exemption "${selector}" is absent from lockfile packages`,
        )
      }
    }
  }

  return errors
}
