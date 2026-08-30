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

function readPullState(repository: string, prNumber: string, exec: GhExec): string[] {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return exec([
        'api',
        `repos/${repository}/pulls/${prNumber}`,
        '--jq',
        '[.head.sha, .base.sha, .draft, .state] | @tsv',
      ]).split('\t')
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

export function createGhPostReviewIo(options: {
  repository: string
  prNumber: string
  payloadPath: string
  payloadBytes: Buffer
  token: string
  exec: GhExec
  expectedHeadSha?: string
  expectedBaseSha?: string
}): PostReviewIo {
  const { repository, prNumber, payloadBytes, token, exec, expectedHeadSha, expectedBaseSha } =
    options
  return {
    readFile() {
      return payloadBytes
    },
    removeFile(path) {
      rmSync(path, { force: true })
    },
    getHeadSha() {
      if (!/^[1-9][0-9]*$/u.test(prNumber)) {
        throw new ReviewPayloadError('PR_NUMBER must be a positive integer.')
      }
      if (Boolean(expectedHeadSha) !== Boolean(expectedBaseSha)) {
        throw new ReviewPayloadError(
          'EXPECTED_HEAD_SHA and EXPECTED_BASE_SHA must be provided together.',
        )
      }
      if (expectedHeadSha && !/^[0-9a-f]{40}$/u.test(expectedHeadSha)) {
        throw new ReviewPayloadError('EXPECTED_HEAD_SHA must be a full lowercase commit SHA.')
      }
      if (expectedBaseSha && !/^[0-9a-f]{40}$/u.test(expectedBaseSha)) {
        throw new ReviewPayloadError('EXPECTED_BASE_SHA must be a full lowercase commit SHA.')
      }
      const state = readPullState(repository, prNumber, exec)
      const [headSha = '', baseSha = '', draft = '', pullState = ''] = state
      if (!/^[0-9a-f]{40}$/u.test(headSha)) {
        throw new ReviewPayloadError(`Could not resolve PR head SHA (got "${headSha}").`)
      }
      if (!/^[0-9a-f]{40}$/u.test(baseSha)) {
        throw new ReviewPayloadError(`Could not resolve PR base SHA (got "${baseSha}").`)
      }
      if (draft !== 'false') {
        throw new ReviewPayloadError('Pull request became a draft before posting the review.')
      }
      if (pullState !== 'open') {
        throw new ReviewPayloadError('Pull request closed before posting the review.')
      }
      if (expectedHeadSha && headSha !== expectedHeadSha) {
        throw new ReviewPayloadError('PR head changed before posting the selected review.')
      }
      if (expectedBaseSha && baseSha !== expectedBaseSha) {
        throw new ReviewPayloadError('PR base changed before posting the selected review.')
      }
      // Preserve the orchestrator-selected revision as the review commit_id after equality checks.
      return expectedHeadSha || headSha
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

/** @deprecated Use postReviewWithTokenFromEnv or postClaudeReviewFromEnv explicitly. */
export async function postReviewFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  exec: GhExec = createGhExec(),
  claudeIo = createActionsClaudeTokenIo(env),
): Promise<{ posted: boolean }> {
  const token = resolveReviewPostToken(env)
  if (token.source === 'github-token') return postReviewWithTokenFromEnv(env, exec, token.token)
  return await postClaudeReviewFromEnv(env, exec, claudeIo)
}

function createPostWithToken(env: NodeJS.ProcessEnv, exec: GhExec) {
  const repository = requireEnv('GITHUB_REPOSITORY', env)
  const prNumber = requireEnv('PR_NUMBER', env)
  const payloadPath = requireEnv('CODE_REVIEW_PAYLOAD_PATH', env)
  const payloadBytes = readRegularReviewPayload(payloadPath, 'required')!
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
): { posted: boolean } {
  if (!token) throw new ReviewPayloadError('GH_TOKEN or GITHUB_TOKEN is required.')
  return createPostWithToken(env, withTokenEnv(exec, env, token))(token)
}

export async function postClaudeReviewFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  exec: GhExec = createGhExec(),
  claudeIo = createActionsClaudeTokenIo(env),
): Promise<{ posted: boolean }> {
  return await withClaudeAppToken(claudeIo, (token) =>
    createPostWithToken(env, withTokenEnv(exec, env, token))(token),
  )
}
