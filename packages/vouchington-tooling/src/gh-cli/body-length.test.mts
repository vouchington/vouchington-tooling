import { describe, expect, it } from 'vitest'

import { GITHUB_BODY_MAX_CHARACTERS, validateGitHubBodyLength } from './index.mts'

describe('validateGitHubBodyLength', () => {
  it("accepts a body at GitHub's character limit", () => {
    const body = 'a'.repeat(GITHUB_BODY_MAX_CHARACTERS)

    expect(validateGitHubBodyLength(body)).toEqual({
      ok: true,
      characterCount: GITHUB_BODY_MAX_CHARACTERS,
      utf8ByteCount: GITHUB_BODY_MAX_CHARACTERS,
      maxCharacterCount: GITHUB_BODY_MAX_CHARACTERS,
    })
  })

  it("rejects a body over GitHub's character limit", () => {
    const body = 'a'.repeat(GITHUB_BODY_MAX_CHARACTERS + 1)

    expect(validateGitHubBodyLength(body)).toEqual({
      ok: false,
      characterCount: GITHUB_BODY_MAX_CHARACTERS + 1,
      utf8ByteCount: GITHUB_BODY_MAX_CHARACTERS + 1,
      maxCharacterCount: GITHUB_BODY_MAX_CHARACTERS,
    })
  })

  it('counts astral Unicode by code point and reports UTF-8 bytes separately', () => {
    const body = '😀'.repeat(GITHUB_BODY_MAX_CHARACTERS)

    expect(validateGitHubBodyLength(body)).toEqual({
      ok: true,
      characterCount: GITHUB_BODY_MAX_CHARACTERS,
      utf8ByteCount: GITHUB_BODY_MAX_CHARACTERS * 4,
      maxCharacterCount: GITHUB_BODY_MAX_CHARACTERS,
    })
  })
})
