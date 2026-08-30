export { MAX_COMMENTS, MAX_PAYLOAD_BYTES, PostReviewError, runPostReview } from './post.mts'
export type { PostResult, PostReviewIo, PullFile, ReviewComment, SanitizedReview } from './post.mts'

export { requireEnv, resolveReviewPostToken } from './token.mts'
export type { ReviewPostToken } from './token.mts'

/** @deprecated Import Claude helpers from vouchington-tooling/gha-claude-post-review. */
export {
  CLAUDE_APP_TOKEN_EXCHANGE_URL,
  CLAUDE_OIDC_AUDIENCE,
  CLAUDE_POSTER_PERMISSIONS,
  GITHUB_INSTALLATION_TOKEN_URL,
  createActionsClaudeTokenIo,
  mintClaudeAppToken,
  oidcTokenRequest,
  revokeClaudeAppToken,
  withClaudeAppToken,
} from './claude-token.mts'
/** @deprecated Import Claude helpers from vouchington-tooling/gha-claude-post-review. */
export type { ClaudeTokenIo, FetchLike } from './claude-token.mts'

export {
  createGhExec,
  createGhPostReviewIo,
  postReviewWithTokenFromEnv,
  postWithGh,
  writePostedOutput,
} from './github.mts'
/** @deprecated Select an explicit posting adapter. */
export { postClaudeReviewFromEnv, postReviewFromEnv } from './github.mts'
export type { GhExec } from './github.mts'

export { runPostReviewCli } from './cli.mts'
