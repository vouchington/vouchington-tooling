import { describe, expect, it, vi } from 'vitest'

import {
  CLAUDE_APP_TOKEN_EXCHANGE_URL,
  CLAUDE_OIDC_AUDIENCE,
  CLAUDE_POSTER_PERMISSIONS,
  GITHUB_INSTALLATION_TOKEN_URL,
  createActionsClaudeTokenIo,
  oidcTokenRequest,
  withClaudeAppToken,
  type ClaudeTokenIo,
  type FetchLike,
} from './claude-token.mts'
import { PostReviewError } from './post.mts'

type RecordedRequest = { url: string; init: RequestInit }

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

function makeIo(options: {
  oidc?: string
  exchangeStatus?: number
  exchangeBody?: unknown
  requests?: RecordedRequest[]
}): ClaudeTokenIo {
  const requests = options.requests ?? []
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({ url, init })
    if (url === CLAUDE_APP_TOKEN_EXCHANGE_URL) {
      return jsonResponse(
        options.exchangeStatus ?? 200,
        options.exchangeBody ?? { token: 'app-token' },
      )
    }
    return jsonResponse(204, {})
  }
  return {
    async getOidcToken() {
      return options.oidc ?? 'oidc-jwt'
    },
    fetch: fetchImpl,
    mask() {},
  }
}

describe('Claude App token mint', () => {
  it('requests the GitHub OIDC JWT with the Claude Code Action audience', () => {
    const request = oidcTokenRequest({
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token?foo=1',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
    })
    expect(request.url).toContain(`audience=${encodeURIComponent(CLAUDE_OIDC_AUDIENCE)}`)
    expect(request.url).toContain('foo=1')
    expect(request.token).toBe('request-token')
  })

  it('requests contents read plus pull_requests write so Anthropic accepts the mint', () => {
    expect(CLAUDE_POSTER_PERMISSIONS).toEqual({
      contents: 'read',
      pull_requests: 'write',
    })
  })

  it('exchanges the OIDC JWT for a pull_requests write App token and always revokes', async () => {
    const requests: RecordedRequest[] = []
    const posted: string[] = []
    await withClaudeAppToken(makeIo({ requests }), (token) => {
      posted.push(token)
      return { posted: true }
    })
    expect(posted).toEqual(['app-token'])
    const exchange = requests.find((entry) => entry.url === CLAUDE_APP_TOKEN_EXCHANGE_URL)
    expect(exchange?.init.method).toBe('POST')
    expect(exchange?.init.body).toBe(JSON.stringify({ permissions: CLAUDE_POSTER_PERMISSIONS }))
    expect(
      requests.some(
        (entry) => entry.url === GITHUB_INSTALLATION_TOKEN_URL && entry.init.method === 'DELETE',
      ),
    ).toBe(true)
  })

  it('revokes even when posting throws', async () => {
    const requests: RecordedRequest[] = []
    await expect(
      withClaudeAppToken(makeIo({ requests }), () => {
        throw new Error('POST failed')
      }),
    ).rejects.toThrow('POST failed')
    expect(requests.some((entry) => entry.url === GITHUB_INSTALLATION_TOKEN_URL)).toBe(true)
  })

  it('fails closed when the exchange body cannot be parsed', async () => {
    await expect(
      withClaudeAppToken(
        {
          async getOidcToken() {
            return 'oidc'
          },
          async fetch() {
            return {
              ok: false,
              status: 500,
              async json() {
                throw new Error('no json')
              },
            }
          },
          mask() {},
        },
        (token) => token,
      ),
    ).rejects.toThrow('Claude App token exchange failed (HTTP 500)')
  })

  it('does not invoke the poster when mint fails', async () => {
    const posted: string[] = []
    await expect(
      withClaudeAppToken(
        makeIo({ exchangeStatus: 403, exchangeBody: { message: 'nope' } }),
        (token) => {
          posted.push(token)
          return token
        },
      ),
    ).rejects.toBeInstanceOf(PostReviewError)
    expect(posted).toEqual([])
  })

  it('fails closed when Anthropic rejects a workflow-validation mint', async () => {
    const validation = {
      error: {
        message:
          'Workflow validation failed. The workflow file must exist and have identical content to the version on the repository default branch.',
      },
    }
    await expect(
      withClaudeAppToken(
        makeIo({ exchangeStatus: 401, exchangeBody: validation }),
        (token) => token,
      ),
    ).rejects.toThrow('Workflow validation failed')
    await expect(
      withClaudeAppToken(
        makeIo({ exchangeStatus: 500, exchangeBody: { error: { code: 1 } } }),
        (token) => token,
      ),
    ).rejects.toThrow('Claude App token exchange failed (HTTP 500).')
  })

  it('rejects a missing OIDC request URL and an empty exchange token', async () => {
    expect(() => oidcTokenRequest({})).toThrow(PostReviewError)
    expect(
      oidcTokenRequest({
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
      }).url,
    ).toContain('?audience=')
    await expect(
      withClaudeAppToken(makeIo({ exchangeBody: { message: 'no token' } }), (token) => token),
    ).rejects.toThrow('returned no token')
  })

  it('mints from Actions OIDC env, masks the App token, and fails closed on OIDC errors', async () => {
    const requests: RecordedRequest[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      requests.push({ url, init })
      if (url.includes('audience=')) return jsonResponse(200, { value: 'oidc-jwt' })
      if (url === CLAUDE_APP_TOKEN_EXCHANGE_URL)
        return jsonResponse(200, { app_token: 'app-token' })
      return jsonResponse(204, {})
    }
    const io = createActionsClaudeTokenIo(
      {
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
      },
      fetchImpl,
    )
    const chunks: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })
    try {
      await expect(withClaudeAppToken(io, (token) => token)).resolves.toBe('app-token')
    } finally {
      write.mockRestore()
    }
    expect(chunks.join('')).toContain('::add-mask::app-token')
    expect(requests[0]?.url).toContain(`audience=${encodeURIComponent(CLAUDE_OIDC_AUDIENCE)}`)
    expect(requests[0]?.init.headers).toEqual({ Authorization: 'Bearer request-token' })
    expect(requests[1]?.url).toBe(CLAUDE_APP_TOKEN_EXCHANGE_URL)
    expect(requests[1]?.init.headers).toMatchObject({ Authorization: 'Bearer oidc-jwt' })

    const failing = createActionsClaudeTokenIo(
      {
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
      },
      async () => jsonResponse(401, {}),
    )
    await expect(failing.getOidcToken()).rejects.toThrow('OIDC token request failed')
    const emptyJwt = createActionsClaudeTokenIo(
      {
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
      },
      async () => jsonResponse(200, { message: 'no jwt' }),
    )
    await expect(emptyJwt.getOidcToken()).rejects.toThrow('returned no token')
    const nullJwt = createActionsClaudeTokenIo(
      {
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
      },
      async () => jsonResponse(200, null),
    )
    await expect(nullJwt.getOidcToken()).rejects.toThrow('returned no token')
    const numericJwt = createActionsClaudeTokenIo(
      {
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
      },
      async () => jsonResponse(200, { token: 1 }),
    )
    await expect(numericJwt.getOidcToken()).rejects.toThrow('returned no token')
    await expect(
      withClaudeAppToken(
        makeIo({ exchangeStatus: 500, exchangeBody: { error: 'denied' } }),
        (token) => token,
      ),
    ).rejects.toThrow('Claude App token exchange failed (HTTP 500).')
  })
})
