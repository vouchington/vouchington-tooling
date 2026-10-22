import type { Page } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import { setupVirtualAuthenticator } from './virtual-authenticator.mts'

describe('setupVirtualAuthenticator', () => {
  it('enables WebAuthn and adds an internal ctap2 authenticator', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'WebAuthn.addVirtualAuthenticator') return { authenticatorId: 'auth-1' }
      return {}
    })
    const newCDPSession = vi.fn(async () => ({ send }))
    const context = vi.fn(() => ({ newCDPSession }))
    const page = { context } as unknown as Page

    const result = await setupVirtualAuthenticator(page)

    expect(newCDPSession).toHaveBeenCalledWith(page)
    expect(send).toHaveBeenNthCalledWith(1, 'WebAuthn.enable', { enableUI: false })
    expect(send).toHaveBeenNthCalledWith(2, 'WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    })
    expect(result.authenticatorId).toBe('auth-1')
    expect(result.client).toEqual({ send })
  })
})
