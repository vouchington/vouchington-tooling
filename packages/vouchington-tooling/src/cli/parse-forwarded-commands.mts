type ForwardedCommand =
  | { kind: 'with-host-lock'; args: string[] }
  | { kind: 'host-storage'; args: string[] }
  | { kind: 'pnpm-install'; args: string[] }
  | { kind: 'vitest-blob-manifest'; args: string[] }
  | { kind: 'vitest-report-attempt'; args: string[] }
  | { kind: 'prepare-vitest-reports'; args: string[] }
  | { kind: 'nuget-central-version'; args: string[] }
  | { kind: 'verify-workflow-secrets'; args: string[] }
  | { kind: 'dead-code'; args: string[] }
  | { kind: 'swift-semantic-equal'; args: string[] }
  | { kind: 'post-review'; args: string[] }
  | { kind: 'stage-review-payload'; args: string[] }
  | { kind: 'retrospective-transcript'; args: string[] }
  | { kind: 'retrospective-facts'; args: string[] }
  | { kind: 'agent-blackboard'; args: string[] }
  | { kind: 'mcp'; args: string[] }
  | { kind: 'hook'; args: string[] }
  | { kind: 'worktree'; args: string[] }
  | { kind: 'transient-retry'; args: string[] }
  | { kind: 'sandbox-command-audit'; args: string[] }
  | { kind: 'cloc'; args: string[] }
  | { kind: 'coverage-scope-check'; args: string[] }
  | { kind: 'trivy-policy'; args: string[] }
  | { kind: 'docker-image-mirror'; args: string[] }
  | { kind: 'storybook-browser-runner'; args: string[] }
  | { kind: 'tmux'; args: string[] }

export function parseForwardedCommand(
  command: string | undefined,
  args: string[],
): ForwardedCommand | undefined {
  if (command === 'with-host-lock') return { kind: 'with-host-lock', args }
  if (command === 'host-storage') return { kind: 'host-storage', args }
  if (command === 'pnpm-install') return { kind: 'pnpm-install', args }
  if (command === 'vitest-blob-manifest') return { kind: 'vitest-blob-manifest', args }
  if (command === 'vitest-report-attempt') return { kind: 'vitest-report-attempt', args }
  if (command === 'prepare-vitest-reports') return { kind: 'prepare-vitest-reports', args }
  if (command === 'nuget-central-version') return { kind: 'nuget-central-version', args }
  if (command === 'verify-workflow-secrets') return { kind: 'verify-workflow-secrets', args }
  if (command === 'dead-code') return { kind: 'dead-code', args }
  if (command === 'swift-semantic-equal') return { kind: 'swift-semantic-equal', args }
  if (command === 'post-review') return { kind: 'post-review', args }
  if (command === 'stage-review-payload') return { kind: 'stage-review-payload', args }
  if (command === 'retrospective-transcript') return { kind: 'retrospective-transcript', args }
  if (command === 'retrospective-facts') return { kind: 'retrospective-facts', args }
  if (command === 'agent-blackboard') return { kind: 'agent-blackboard', args }
  if (command === 'mcp') return { kind: 'mcp', args }
  if (command === 'hook') return { kind: 'hook', args }
  if (command === 'worktree') return { kind: 'worktree', args }
  if (command === 'transient-retry') return { kind: 'transient-retry', args }
  if (command === 'sandbox-command-audit') return { kind: 'sandbox-command-audit', args }
  if (command === 'cloc') return { kind: 'cloc', args }
  if (command === 'coverage-scope-check') return { kind: 'coverage-scope-check', args }
  if (command === 'trivy-policy') return { kind: 'trivy-policy', args }
  if (command === 'docker-image-mirror') return { kind: 'docker-image-mirror', args }
  if (command === 'storybook-browser-runner') return { kind: 'storybook-browser-runner', args }
  if (command === 'tmux') return { kind: 'tmux', args }
  return undefined
}
