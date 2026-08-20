import { describe, expect, it } from 'vitest'

import { validateOptionalHttpOrigin } from './index.mts'

describe('validateOptionalHttpOrigin', () => {
  it('accepts an empty optional value and pure HTTP(S) origins', () => {
    expect(() => validateOptionalHttpOrigin('')).not.toThrow()
    expect(() => validateOptionalHttpOrigin('https://images.example.com')).not.toThrow()
    expect(() => validateOptionalHttpOrigin('https://images.example.com/')).not.toThrow()
    expect(() => validateOptionalHttpOrigin('http://localhost:3100')).not.toThrow()
  })

  it.each([
    'ftp://images.example.com',
    'https://user:password@images.example.com',
    'https://images.example.com/sideload',
    'https://images.example.com/?query=1',
    'https://images.example.com/#fragment',
    'not a URL',
  ])('rejects non-origin value %s', (value) => {
    expect(() => validateOptionalHttpOrigin(value, 'cdn_origin')).toThrow(
      /cdn_origin must be empty or a pure HTTP\(S\) origin/,
    )
  })
})
