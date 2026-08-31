/** Reads a GitHub Actions attempt as a canonical, positive decimal integer. */
export function parseGitHubRunAttempt(rawAttempt: string | undefined): number {
  if (!rawAttempt) throw new Error('GITHUB_RUN_ATTEMPT is required')
  if (!/^[1-9][0-9]*$/.test(rawAttempt))
    throw new Error('GITHUB_RUN_ATTEMPT must be a positive integer')
  const attempt = Number(rawAttempt)
  if (!Number.isSafeInteger(attempt))
    throw new Error('GITHUB_RUN_ATTEMPT must be a positive integer')
  return attempt
}
