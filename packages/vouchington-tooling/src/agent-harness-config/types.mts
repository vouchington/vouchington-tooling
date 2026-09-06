export const HARNESS_IDS = ['claude', 'codex', 'grok', 'cursor'] as const

export type HarnessId = (typeof HARNESS_IDS)[number]

export type ApplyTarget =
  | { readonly kind: 'global' }
  | { readonly kind: 'repo'; readonly root: string }

export interface JsonPatch {
  readonly merge?: 'union'
  readonly path: readonly string[]
  readonly value: unknown
}

export type TomlValue = boolean | string | readonly string[]

export interface TomlPatch {
  readonly key: string
  readonly table: string
  readonly value: TomlValue
}

export type FilePlan =
  | { readonly format: 'json'; readonly patches: readonly JsonPatch[]; readonly path: string }
  | { readonly format: 'toml'; readonly patches: readonly TomlPatch[]; readonly path: string }

export interface KeyDrift {
  readonly current: unknown
  readonly desired: unknown
  readonly key: string
  readonly path: string
}

export interface FileResult {
  readonly action: 'create' | 'update' | 'ok' | 'missing'
  readonly drifts: readonly KeyDrift[]
  readonly path: string
}

export interface HarnessPlan {
  readonly files: readonly FilePlan[]
  readonly target: ApplyTarget
}

export interface HarnessCheckResult {
  readonly compliant: boolean
  readonly files: readonly FileResult[]
  readonly prerequisites: readonly HarnessPrerequisite[]
  readonly target: ApplyTarget
}

export interface HarnessPrerequisite {
  readonly harness: HarnessId
  readonly key: string
  readonly message: string
  readonly satisfied: boolean
}

export interface HarnessApplyResult extends HarnessCheckResult {
  readonly written: readonly string[]
}

export interface HarnessConfigOptions {
  readonly extraWritableRoots?: readonly string[]
  readonly harnesses?: readonly HarnessId[]
  readonly home?: string
}

export interface HarnessPolicyDump {
  readonly claude: {
    readonly defaultMode: 'auto'
    readonly sandboxEnabled: true
    readonly sandboxFailIfUnavailable: true
    readonly useAutoModeDuringPlan: true
  }
  readonly codex: {
    readonly approval_policy: 'on-request'
    readonly approvals_reviewer: 'auto_review'
    readonly sandbox_mode: 'workspace-write'
  }
  readonly cursor: { readonly approvalMode: 'auto-review'; readonly sandboxMode: 'enabled' }
  readonly extraWritableRoots: readonly string[]
  readonly grok: {
    readonly auto_mode_enabled: true
    readonly default_auto_mode: true
    readonly permission_mode: 'auto'
    readonly sandbox_profile_defined: 'workspace-write'
    readonly sandbox_profile_requires_cli_selection: true
  }
}
