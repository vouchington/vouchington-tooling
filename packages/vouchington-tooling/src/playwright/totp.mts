import type { Page } from '@playwright/test'

/**
 * Generate a TOTP code using WebCrypto in the browser context.
 * Uses SHA-1 HMAC with 6-digit output and 30-second period (RFC 6238).
 */
export function generateTotpCode(page: Page, base32Secret: string): Promise<string> {
  return page.evaluate(async (secret: string) => {
    const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    const BASE32_MAP = new Map(Array.from(BASE32).map((ch, i) => [ch, i]))
    const upper = secret.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')

    let bits = ''
    for (const c of upper) {
      const idx = BASE32_MAP.get(c)
      if (idx !== undefined) bits += idx.toString(2).padStart(5, '0')
    }
    const bytes: number[] = []
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2))
    }

    const counter = Math.floor(Date.now() / 1000 / 30)
    const counterBytes = new Uint8Array(8)
    let rem = counter
    for (let i = 7; i >= 0; i--) {
      counterBytes[i] = rem & 0xff
      rem = Math.floor(rem / 256)
    }

    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(bytes),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    )
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes))
    const offset = sig[19]! & 0x0f
    const code =
      (((sig[offset]! & 0x7f) << 24) |
        ((sig[offset + 1]! & 0xff) << 16) |
        ((sig[offset + 2]! & 0xff) << 8) |
        (sig[offset + 3]! & 0xff)) %
      1_000_000
    return String(code).padStart(6, '0')
  }, base32Secret)
}
