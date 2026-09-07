import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

import { ReviewPayloadError } from '../gha-review-payload/index.mts'
import { readRegularReviewPayload } from '../gha-review-payload/index.mts'
import { createActionsClaudeTokenIo, withClaudeAppToken } from './claude-token.mts'
import { runPostReview, type PostReviewResult } from './post.mts'
import { createGhPostReviewIo } from './pull-io.mts'
import { requireEnv, resolveReviewPostToken } from './token.mts'

export { createGhPostReviewIo, postWithGh } from './pull-io.mts'

export type GhExec = (
  args: readonly string[],
  options?: { input?: string; env?: NodeJS.ProcessEnv },
) => string

export function createGhExec(exec: typeof execFileSync = execFileSync): GhExec {
  return (args, options) =>
    exec('gh', [...args], {
      encoding: 'utf8',
      input: options?.input,
      env: options?.env ?? process.env,
    }).trim()
}

export function writePostedOutput(
  posted: boolean,
  commentCount: number,
  outputPath = process.env.GITHUB_OUTPUT,
): void {
  if (!outputPath) return
  appendFileSync(outputPath, `posted=${posted ? 'true' : 'false'}\ncomment_count=${commentCount}\n`)
}

/** @deprecated Use postReviewWithTokenFromEnv or postClaudeReviewFromEnv explicitly. */
export async function postReviewFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  exec: GhExec = createGhExec(),
  claudeIo = createActionsClaudeTokenIo(env),
): Promise<PostReviewResult> {
  const token = resolveReviewPostToken(env)
  if (token.source === 'github-token') return postReviewWithTokenFromEnv(env, exec, token.token)
  return await postClaudeReviewFromEnv(env, exec, claudeIo)
}

function createPostWithToken(env: NodeJS.ProcessEnv, exec: GhExec) {
  const repository = requireEnv('GITHUB_REPOSITORY', env)
  const prNumber = requireEnv('PR_NUMBER', env)
  const payloadPath = requireEnv('CODE_REVIEW_PAYLOAD_PATH', env)
  const payloadBytes = readRegularReviewPayload(payloadPath, 'required')!
  const providerName = env.PROVIDER_NAME || undefined
  return (token: string) =>
    runPostReview(
      payloadPath,
      createGhPostReviewIo({
        repository,
        prNumber,
        payloadPath,
        payloadBytes,
        token,
        exec,
        expectedHeadSha: env.EXPECTED_HEAD_SHA ?? '',
        expectedBaseSha: env.EXPECTED_BASE_SHA ?? '',
      }),
      providerName,
    )
}

function withTokenEnv(exec: GhExec, env: NodeJS.ProcessEnv, token: string): GhExec {
  const tokenEnv = { ...env, GH_TOKEN: token, GITHUB_TOKEN: token }
  return (args, options) => exec(args, { ...options, env: { ...options?.env, ...tokenEnv } })
}

export function postReviewWithTokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  exec: GhExec = createGhExec(),
  token = env.GH_TOKEN || env.GITHUB_TOKEN,
): PostReviewResult {
  if (!token) throw new ReviewPayloadError('GH_TOKEN or GITHUB_TOKEN is required.')
  return createPostWithToken(env, withTokenEnv(exec, env, token))(token)
}

export async function postClaudeReviewFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  exec: GhExec = createGhExec(),
  claudeIo = createActionsClaudeTokenIo(env),
): Promise<PostReviewResult> {
  return await withClaudeAppToken(claudeIo, (token) =>
    createPostWithToken(env, withTokenEnv(exec, env, token))(token),
  )
}
