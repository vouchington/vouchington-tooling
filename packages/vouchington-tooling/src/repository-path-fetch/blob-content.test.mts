import { describe, expect, it } from 'vitest'
import { decodeBlobContent } from './blob-content.mts'

describe('decodeBlobContent', () => {
  it('rejects a non-canonical base64 representation', () => {
    expect(() => decodeBlobContent('AB==', 'source/file')).toThrow(
      'invalid blob encoding: source/file',
    )
  })

  it('rejects decoded content above its byte limit', () => {
    expect(() => decodeBlobContent('YWE=', 'source/file', 1)).toThrow(
      'source blob exceeds size limit: source/file',
    )
  })
})
