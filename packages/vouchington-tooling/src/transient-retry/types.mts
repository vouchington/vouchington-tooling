/** Provider-neutral context supplied to a transient-retry rule. */
export interface RetryContext {
  /** The provider's current run attempt, starting at one. */
  runAttempt: number
  /** A normalized attempt count shared by rules when provider attempts are sparse. */
  retryAttempt?: number
  /** A normalized next-occurrence count for individual rules. */
  retryAttempts?: ReadonlyMap<string, number>
  /** Targets that the provider resolved for this run. */
  targetNames?: ReadonlySet<string>
}

export type RetryDecision = 'rerun' | 'ignore' | 'fresh-plan' | 'reap-lock' | 'dispatch'

export type RetryTarget =
  | { targetName: string; targetFamily?: never; resolveTargetName?: never }
  | {
      targetName?: never
      /** Static prefix shared by every dynamically named target in the family. */
      targetFamily: string
      /** Resolves the exact target for this run, or null when it cannot be determined. */
      resolveTargetName: (context: RetryContext) => string | null
    }

interface RetryRuleBase {
  /** Stable identifier for logs and telemetry. */
  id: string
  /** Maximum normalized attempts at which this rule may match. */
  maxAttempts: number
  match: (context: RetryContext) => boolean | Promise<boolean>
}

export type RetryRule =
  | (RetryRuleBase & {
      decision?: 'rerun'
      /** When omitted, the match is an untargeted provider-level rerun. */
      retryTarget?: RetryTarget
    })
  | (RetryRuleBase & {
      decision: Exclude<RetryDecision, 'rerun'>
      retryTarget?: never
    })
