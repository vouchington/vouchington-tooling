import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  CLAUDE_APP_TOKEN_EXCHANGE_URL,
  CLAUDE_OIDC_AUDIENCE,
  CLAUDE_POSTER_PERMISSIONS,
  GITHUB_INSTALLATION_TOKEN_URL,
  createActionsClaudeTokenIo,
  mintClaudeAppToken,
  oidcTokenRequest,
  postClaudeReviewFromEnv,
  revokeClaudeAppToken,
  withClaudeAppToken,
  type ClaudeTokenIo,
  type FetchLike,
} from './index.mts'

describe('gha-claude-post-review exports', () => {
  it('exposes the explicit Claude posting adapter', () => {
    expect(typeof postClaudeReviewFromEnv).toBe('function')
    expect(typeof withClaudeAppToken).toBe('function')
    expect(typeof createActionsClaudeTokenIo).toBe('function')
    expect(typeof mintClaudeAppToken).toBe('function')
    expect(typeof oidcTokenRequest).toBe('function')
    expect(typeof revokeClaudeAppToken).toBe('function')
    expect(CLAUDE_APP_TOKEN_EXCHANGE_URL).toMatch(/^https:/u)
    expect(CLAUDE_OIDC_AUDIENCE).toBeTruthy()
    expect(CLAUDE_POSTER_PERMISSIONS).toBeTruthy()
    expect(GITHUB_INSTALLATION_TOKEN_URL).toMatch(/^https:/u)
    expectTypeOf<ClaudeTokenIo>().toBeObject()
    expectTypeOf<FetchLike>().toBeFunction()
  })
})
