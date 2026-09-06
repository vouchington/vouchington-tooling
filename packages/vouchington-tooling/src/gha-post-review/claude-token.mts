import { ReviewPayloadError as PostReviewError } from '../gha-review-payload/index.mts'

export const CLAUDE_OIDC_AUDIENCE = 'claude-code-github-action'
export const CLAUDE_APP_TOKEN_EXCHANGE_URL =
  'https://api.anthropic.com/api/github/github-app-token-exchange'
// Anthropic rejects the exchange unless custom permissions include contents
// (read or write), even when the token is only used to POST /reviews.
export const CLAUDE_POSTER_PERMISSIONS = {
  contents: 'read',
  pull_requests: 'write',
} as const
export const GITHUB_INSTALLATION_TOKEN_URL = 'https://api.github.com/installation/token'

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export type ClaudeTokenIo = {
  getOidcToken(): Promise<string>
  fetch: FetchLike
  mask(token: string): void
}

export function oidcTokenRequest(env: NodeJS.ProcessEnv): { url: string; token: string } {
  const base = env.ACTIONS_ID_TOKEN_REQUEST_URL
  const token = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!base || !token) {
    throw new PostReviewError('OIDC token request env is missing.')
  }
  const separator = base.includes('?') ? '&' : '?'
  return {
    url: `${base}${separator}audience=${encodeURIComponent(CLAUDE_OIDC_AUDIENCE)}`,
    token,
  }
}

function readToken(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return ''
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- establish a record view after validating the untrusted response object
  const record = payload as Record<string, unknown>
  const token = record.token ?? record.app_token ?? record.value
  return typeof token === 'string' ? token : ''
}

function readErrorMessage(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return ''
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- establish a record view after validating the untrusted response object
  const record = payload as Record<string, unknown>
  if (typeof record.message === 'string' && record.message.length > 0) return record.message
  const nested = record.error
  if (nested !== null && typeof nested === 'object') {
    const message = (nested as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  return ''
}

function exchangeErrorMessage(status: number, payload: unknown): string {
  const detail = readErrorMessage(payload)
  const suffix = detail.length > 0 ? `: ${detail}` : ''
  return `Claude App token exchange failed (HTTP ${status})${suffix}.`
}

export async function mintClaudeAppToken(io: ClaudeTokenIo): Promise<string> {
  const oidcToken = await io.getOidcToken()
  const response = await io.fetch(CLAUDE_APP_TOKEN_EXCHANGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${oidcToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ permissions: CLAUDE_POSTER_PERMISSIONS }),
  })
  if (!response.ok) {
    throw new PostReviewError(
      exchangeErrorMessage(response.status, await response.json().catch(() => null)),
    )
  }
  const appToken = readToken(await response.json())
  if (appToken.length === 0) {
    throw new PostReviewError('Claude App token exchange returned no token.')
  }
  io.mask(appToken)
  return appToken
}

export async function revokeClaudeAppToken(token: string, io: Pick<ClaudeTokenIo, 'fetch'>) {
  await io.fetch(GITHUB_INSTALLATION_TOKEN_URL, {
    method: 'DELETE',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function withClaudeAppToken<T>(
  io: ClaudeTokenIo,
  fn: (token: string) => T | Promise<T>,
): Promise<T> {
  const token = await mintClaudeAppToken(io)
  try {
    return await fn(token)
  } finally {
    await revokeClaudeAppToken(token, io)
  }
}

export function createActionsClaudeTokenIo(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): ClaudeTokenIo {
  return {
    async getOidcToken() {
      const request = oidcTokenRequest(env)
      const response = await fetchImpl(request.url, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
      if (!response.ok) {
        throw new PostReviewError(`OIDC token request failed (HTTP ${response.status}).`)
      }
      const jwt = readToken(await response.json())
      if (jwt.length === 0) throw new PostReviewError('OIDC token request returned no token.')
      return jwt
    },
    fetch: fetchImpl,
    mask(token) {
      process.stdout.write(`::add-mask::${token}\n`)
    },
  }
}
