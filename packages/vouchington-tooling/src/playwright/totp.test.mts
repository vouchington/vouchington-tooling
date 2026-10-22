import type { Page } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateTotpCode } from './totp.mts'

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

function createPage(): Page {
  return {
    evaluate: async (callback: (secret: string) => Promise<string>, secret: string) =>
      callback(secret),
  } as unknown as Page
}

describe('generateTotpCode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('matches the RFC 6238 SHA-1 vectors', async () => {
    const page = createPage()
    vi.spyOn(Date, 'now').mockReturnValue(59_000)
    await expect(generateTotpCode(page, RFC_SECRET)).resolves.toBe('287082')

    vi.spyOn(Date, 'now').mockReturnValue(1_111_111_111_000)
    await expect(generateTotpCode(page, RFC_SECRET)).resolves.toBe('050471')
  })

  it('accepts spaced, padded, lowercase secrets and skips characters outside the alphabet', async () => {
    const page = createPage()
    vi.spyOn(Date, 'now').mockReturnValue(59_000)

    await expect(
      generateTotpCode(page, 'gezd gnbv gy3t qojq gez dgnb vgy3 tqoj q===='),
    ).resolves.toBe('287082')
    await expect(generateTotpCode(page, `${RFC_SECRET}1`)).resolves.toBe('287082')
  })
})
