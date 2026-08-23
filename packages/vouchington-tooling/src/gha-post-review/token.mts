import { ReviewPayloadError } from '../gha-review-payload/index.mts'

export type ReviewPostToken = { source: 'github-token'; token: string } | { source: 'claude-app' }

export function resolveReviewPostToken(env: NodeJS.ProcessEnv = process.env): ReviewPostToken {
  const source = env.CODE_REVIEW_TOKEN_SOURCE || 'claude-app'
  if (source === 'github-token') {
    const token = env.GH_TOKEN || env.GITHUB_TOKEN
    if (!token) throw new ReviewPayloadError('GH_TOKEN or GITHUB_TOKEN is required.')
    return { source, token }
  }
  if (source !== 'claude-app') {
    throw new ReviewPayloadError(`Unknown CODE_REVIEW_TOKEN_SOURCE "${source}".`)
  }
  return { source: 'claude-app' }
}

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]
  if (!value) throw new ReviewPayloadError(`${name} is required.`)
  return value
}
