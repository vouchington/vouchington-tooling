import { execFileSync } from 'node:child_process'
import { appendFileSync, rmSync } from 'node:fs'

import { parseReviewFilesJson } from '../gha-review-payload/index.mts'
import { ReviewPayloadError } from '../gha-review-payload/index.mts'
import { createActionsClaudeTokenIo, withClaudeAppToken } from './claude-token.mts'
import { runPostReview, type PostResult, type PostReviewIo, type SanitizedReview } from './post.mts'
import { requireEnv, resolveReviewPostToken } from './token.mts'
import { readRegularReviewPayload } from '../gha-review-payload/index.mts'

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

export function postWithGh(
  repository: string,
  prNumber: string,
  payload: SanitizedReview,
  token: string,
  exec: GhExec,
): PostResult {
  try {
    exec(
      ['api', '--method', 'POST', `repos/${repository}/pulls/${prNumber}/reviews`, '--input', '-'],
      {
        input: JSON.stringify(payload),
        env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
      },
    )
    return { ok: true, status: 201, body: '' }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    const text = `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`
    const status = Number(/HTTP\s+(\d{3})/u.exec(text)?.[1] ?? 0)
    return { ok: false, status, body: text }
  }
}

export function writePostedOutput(posted: boolean, outputPath = process.env.GITHUB_OUTPUT): void {
  if (!outputPath) return
  appendFileSync(outputPath, `posted=${posted ? 'true' : 'false'}\n`)
}

export function createGhPostReviewIo(options: {
  repository: string
  prNumber: string
  payloadPath: string
  payloadBytes: Buffer
  token: string
  exec: GhExec
}): PostReviewIo {
  const { repository, prNumber, payloadBytes, token, exec } = options
  return {
    readFile() {
      return payloadBytes
    },
    removeFile(path) {
      rmSync(path, { force: true })
    },
    getHeadSha() {
      const sha = exec(['api', `repos/${repository}/pulls/${prNumber}`, '--jq', '.head.sha'])
      if (!/^[0-9a-f]{40}$/u.test(sha)) {
        throw new ReviewPayloadError(`Could not resolve PR head SHA (got "${sha}").`)
      }
      return sha
    },
    listPullFiles() {
      return parseReviewFilesJson(
        exec(['api', '--paginate', `repos/${repository}/pulls/${prNumber}/files?per_page=100`]),
      )
    },
    postReview(payload) {
      return postWithGh(repository, prNumber, payload, token, exec)
    },
  }
}

export async function postReviewFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  exec: GhExec = createGhExec(),
  claudeIo = createActionsClaudeTokenIo(env),
): Promise<{ posted: boolean }> {
  const repository = requireEnv('GITHUB_REPOSITORY', env)
  const prNumber = requireEnv('PR_NUMBER', env)
  const payloadPath = requireEnv('CODE_REVIEW_PAYLOAD_PATH', env)
  const payloadBytes = readRegularReviewPayload(payloadPath, 'required')!
  const postWithToken = (token: string) =>
    runPostReview(
      payloadPath,
      createGhPostReviewIo({
        repository,
        prNumber,
        payloadPath,
        payloadBytes,
        token,
        exec,
      }),
    )
  const token = resolveReviewPostToken(env)
  if (token.source === 'github-token') return postWithToken(token.token)
  return await withClaudeAppToken(claudeIo, postWithToken)
}
