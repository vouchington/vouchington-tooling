export { createCommandRunner, runGh, runGit } from './exec.mts'
export { ghSpawnEnv } from './env.mts'
export type { ExecFileText, RunTextCommand } from './exec.mts'

export { DiffCommandError, processDiffCommand } from './diff.mts'
export type { DiffBlockCallback, DiffCommand } from './diff.mts'

export { GITHUB_BODY_MAX_CHARACTERS, validateGitHubBodyLength } from './body-length.mts'
export type { GitHubBodyLengthValidation } from './body-length.mts'

export {
  assertHeadPushed,
  buildGhPrCreateArgs,
  createPullRequest,
  DetachedHeadError,
  HeadNotPushedError,
  HeadOutOfDateError,
  resolveHeadBranch,
} from './pr-create.mts'
export type {
  AssertHeadPushedOptions,
  BuildGhPrCreateArgsOptions,
  CreatePullRequestExecutors,
  CreatePullRequestOptions,
} from './pr-create.mts'

export {
  formatReferenceKey,
  hasClosingIssueReference,
  parseClosingIssueReferences,
} from './closing-refs.mts'
export type { ClosingIssueReference } from './closing-refs.mts'
export { parseNonClosingRefs } from './non-closing-refs.mts'
