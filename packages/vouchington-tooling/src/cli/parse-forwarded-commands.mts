const FORWARDED = [
  'with-host-lock',
  'host-storage',
  'pnpm-install',
  'vitest-blob-manifest',
  'vitest-report-attempt',
  'prepare-vitest-reports',
  'nuget-central-version',
  'verify-workflow-secrets',
  'dead-code',
  'swift-semantic-equal',
  'post-review',
  'stage-review-payload',
  'retrospective-transcript',
  'retrospective-facts',
  'agent-blackboard',
  'mcp',
  'hook',
  'worktree',
  'transient-retry',
  'sandbox-command-audit',
  'cloc',
  'coverage-scope-check',
  'trivy-policy',
  'docker-image-mirror',
  'storybook-browser-runner',
  'tmux',
] as const

type Name = (typeof FORWARDED)[number]
type ForwardedCommand = { [K in Name]: { kind: K; args: string[] } }[Name]

export function parseForwardedCommand(
  command: string | undefined,
  args: string[],
): ForwardedCommand | undefined {
  const kind = FORWARDED.find((name) => name === command)
  return kind === undefined ? undefined : ({ kind, args } as ForwardedCommand)
}
