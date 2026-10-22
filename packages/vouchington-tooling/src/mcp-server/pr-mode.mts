export type PullRequestMode = 'interactive' | 'autonomous'

/**
 * Environment variables that mark an automated launch. A marker counts when it is set to anything
 * except an empty string, `0` or `false`.
 */
const AUTOMATION_MARKERS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BUILDKITE',
  'CIRCLECI',
  'JENKINS_URL',
  'TF_BUILD',
  'CODEBUILD_BUILD_ID',
  'VOUCHINGTON_AUTOMATION',
] as const

/** Whether the server's own launch environment carries an automation marker. */
export function isAutomationContext(env: NodeJS.ProcessEnv): boolean {
  // Claude Code sets this to exactly '0' for unattended runs; a missing or other value never
  // means autonomous, so it can only narrow.
  if (env.CLAUDE_CODE_SESSION_ATTENDED === '0') return true
  return AUTOMATION_MARKERS.some((name) => {
    const value = env[name]?.trim().toLowerCase()
    return value !== undefined && value !== '' && value !== '0' && value !== 'false'
  })
}

/**
 * The mode the policy sees. It fails closed: an automation marker in the server's launch
 * environment means `autonomous` whatever the caller asks, and the caller's `requested` mode can
 * only narrow `interactive` to `autonomous`, never widen it.
 */
export function trustedMode(
  env: NodeJS.ProcessEnv,
  requested: PullRequestMode | undefined,
): PullRequestMode {
  return isAutomationContext(env) || requested === 'autonomous' ? 'autonomous' : 'interactive'
}
