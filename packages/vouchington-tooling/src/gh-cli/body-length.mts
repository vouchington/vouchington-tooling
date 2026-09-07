/** GitHub's maximum issue or pull-request body length, counted in Unicode code points. */
export const GITHUB_BODY_MAX_CHARACTERS = 65_536

/** The measured GitHub body length and whether it fits within GitHub's character limit. */
export interface GitHubBodyLengthValidation {
  readonly ok: boolean
  readonly characterCount: number
  readonly utf8ByteCount: number
  readonly maxCharacterCount: number
}

/**
 * Measures a GitHub issue or pull-request body without altering its content.
 *
 * GitHub's limit is evaluated in Unicode code points. UTF-8 bytes are returned only for diagnostics.
 */
export function validateGitHubBodyLength(body: string): GitHubBodyLengthValidation {
  const characterCount = Array.from(body).length

  return {
    ok: characterCount <= GITHUB_BODY_MAX_CHARACTERS,
    characterCount,
    utf8ByteCount: Buffer.byteLength(body, 'utf8'),
    maxCharacterCount: GITHUB_BODY_MAX_CHARACTERS,
  }
}
