export interface TrivyPolicyOptions {
  /** Trivy ignore registry that every vulnerability gate must name. Default `.trivyignore.yaml`. */
  readonly ignoreFile?: string
  /** Environment variable every gate passes to `--exit-code`. Default `TRIVY_FINDINGS_EXIT_CODE`. */
  readonly findingsExitCodeEnv?: string
  /** Required prefix of the cleanup issue URL in an exception statement. Default: any GitHub issue. */
  readonly cleanupUrlPrefix?: string
  /** Minimum number of vulnerability gates the repository must define. Default 2. */
  readonly minGates?: number
  /** Minimum number of CycloneDX component SBOM scans the repository must define. Default 2. */
  readonly minSboms?: number
  /** Longest allowed exception lifetime in days. Default 30. */
  readonly maxExpiryDays?: number
  /** Clock used to judge exception expiry. */
  readonly now?: Date
}

export interface ResolvedTrivyPolicyOptions {
  readonly ignoreFile: string
  readonly findingsExitCodeEnv: string
  readonly cleanupUrlPattern: string
  readonly minGates: number
  readonly minSboms: number
  readonly maxExpiryDays: number
  readonly now: Date
}

const ANY_GITHUB_ISSUE = String.raw`https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/`

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`)
}

export function resolveOptions(options: TrivyPolicyOptions = {}): ResolvedTrivyPolicyOptions {
  return {
    ignoreFile: options.ignoreFile ?? '.trivyignore.yaml',
    findingsExitCodeEnv: options.findingsExitCodeEnv ?? 'TRIVY_FINDINGS_EXIT_CODE',
    cleanupUrlPattern:
      options.cleanupUrlPrefix === undefined
        ? ANY_GITHUB_ISSUE
        : escapeRegExp(options.cleanupUrlPrefix),
    minGates: options.minGates ?? 2,
    minSboms: options.minSboms ?? 2,
    maxExpiryDays: options.maxExpiryDays ?? 30,
    now: options.now ?? new Date(),
  }
}
