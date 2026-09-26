export interface PnpmLicenseReportEntry {
  readonly name: string
  readonly versions?: readonly string[]
}

/** Shape emitted by `pnpm licenses list --json`. */
export type PnpmLicenseReport = Record<string, PnpmLicenseReportEntry[]>

export interface PnpmCommandResult {
  readonly error?: Error
  readonly status: number | null
  readonly stderr: string
  readonly stdout: string
}

export type PnpmExecutor = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly encoding: 'utf8'; readonly signal: AbortSignal },
) => PnpmCommandResult | Promise<PnpmCommandResult>

export interface DependencyLicenseAllowlistEntry {
  /** Exact SPDX atom allowed by this entry. */
  readonly licenseId: string
  /** Human-readable evidence for the exception. */
  readonly reason: string
  /** Explicit package scope for this allowance. */
  readonly scope:
    | { readonly kind: 'all' }
    | { readonly kind: 'exact'; readonly packageNames: readonly string[] }
}

export interface DependencyLicensePolicy {
  readonly allowlist?: readonly DependencyLicenseAllowlistEntry[]
  readonly deniedLicenseIds: readonly string[]
  readonly deniedLicensePrefixes: readonly string[]
  readonly knownLicenseAliases?: Readonly<Record<string, string>>
}

export interface DependencyLicenseEvaluation {
  readonly deniedAtoms: readonly string[]
  readonly ok: boolean
}

export interface DependencyLicenseViolation extends DependencyLicenseEvaluation {
  readonly licenseExpression: string
  readonly packageName: string
  readonly versions?: readonly string[]
}
