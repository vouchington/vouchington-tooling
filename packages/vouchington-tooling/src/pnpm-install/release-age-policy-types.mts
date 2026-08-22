/** A group of exact package versions temporarily exempted from the age gate. */
export interface ReleaseAgeExemptionGroup {
  /** Exact package@version selectors accepted by pnpm's minimumReleaseAgeExclude. */
  selectors: readonly [string, ...string[]]
  /** Why these releases must bypass the normal supply-chain delay. */
  reason: string
  /** Canonical UTC time at which this group becomes eligible for removal. */
  eligibleForRemovalAt: string
}

/** A package permanently exempted from the age gate, usually because it is first-party. */
export interface ReleaseAgePermanentExemption {
  name: string
  reason: string
}

/** Repository-specific release-age policy. All package names and scopes are caller supplied. */
export interface ReleaseAgePolicyConfig {
  /** Permanent package exemptions. */
  permanentExemptions?: readonly ReleaseAgePermanentExemption[]
  /** Temporary exact-version exemptions. */
  temporaryExemptionGroups?: readonly ReleaseAgeExemptionGroup[]
  /** Prefixes that identify packages expected to be present in the permanent registry. */
  firstPartyPackagePrefixes?: readonly string[]
  /** Whether every permanent exemption must occur in the active package graph. */
  requirePermanentExemptionsActive?: boolean
}

/** Parsed repository state passed to the release-age policy validator. */
export interface ReleaseAgePolicySnapshot {
  /** Raw entries from pnpm-workspace.yaml minimumReleaseAgeExclude. */
  workspaceExcludes: readonly unknown[]
  /** Package names found in manifests and/or the lockfile. */
  activePackageNames?: readonly string[]
  /** Keys from the lockfile `packages` map, used to check temporary selectors. */
  lockfilePackageKeys?: readonly string[]
}
