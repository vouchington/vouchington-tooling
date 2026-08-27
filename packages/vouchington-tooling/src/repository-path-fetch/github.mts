const MAX_COMMIT_BYTES = 1024 * 1024
export const MAX_TREE_BYTES = 32 * 1024 * 1024
export const MAX_BLOB_BYTES = 4 * 1024 * 1024
const MAX_BLOB_BASE64_BYTES = Math.ceil((MAX_BLOB_BYTES * 4) / 3)
export const MAX_BLOB_RESPONSE_BYTES =
  MAX_BLOB_BASE64_BYTES + Math.ceil(MAX_BLOB_BASE64_BYTES / 60) * 2 + 1024
const GITHUB_REQUEST_TIMEOUT_MS = 15_000

export async function getGithubJson<T>(
  api: URL,
  path: string,
  token: string,
  limit = MAX_COMMIT_BYTES,
  timeoutMs = GITHUB_REQUEST_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('response limit must be positive')
  if (!token || token.length > 1024 || tokenContainsUnsafeCharacter(token))
    throw new Error('token contains whitespace or control characters')
  const response = await fetch(new URL(path, api), {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'vouchington-tooling',
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`GitHub API request failed: ${response.status}`)
  const length = Number(response.headers.get('content-length'))
  if (Number.isSafeInteger(length) && length > limit)
    throw new Error('GitHub API response exceeds size limit')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('GitHub API response has no body')
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) {
        try {
          await reader.cancel()
        } catch {}
        throw new Error('GitHub API response exceeds size limit')
      }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } finally {
    reader.releaseLock()
  }
}

function tokenContainsUnsafeCharacter(token: string): boolean {
  if (/%0[ad]/i.test(token)) return true
  for (const character of token) {
    const code = character.codePointAt(0)!
    if (/\s/u.test(character) || code <= 31 || code === 127) return true
  }
  return false
}
