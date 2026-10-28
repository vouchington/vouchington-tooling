/** One workflow file supplied to the evaluator; `path` is relative to the discovery root. */
export interface WorkflowInput {
  path: string
  text: string
}

export interface RequiredJob {
  workflow: string
  job: string
  runsOn: string
}

export interface ForbiddenActions {
  prefixes: readonly string[]
  contains: readonly string[]
  exact: readonly string[]
}

export interface RestrictedLabel {
  label: string
  forbidServices: boolean
  forbiddenActions: ForbiddenActions
}

export interface ExactLabelJobs {
  label: string
  /** `workflow#job` entries. */
  jobs: readonly string[]
}

export interface RunnerPolicyConfig {
  allowedLabels: readonly string[]
  requiredJobs: readonly RequiredJob[]
  exactLabelJobs: readonly ExactLabelJobs[]
  restrictedLabels: readonly RestrictedLabel[]
}

export type RunnerPolicyName =
  | 'discovery'
  | 'parse'
  | 'allowed-labels'
  | 'reusable-delegate'
  | 'required-jobs'
  | 'exact-label-jobs'
  | 'restricted-label'

export interface RunnerPolicyViolation {
  policy: RunnerPolicyName
  workflow?: string
  job?: string
  message: string
}
