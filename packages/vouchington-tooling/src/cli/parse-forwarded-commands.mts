type ForwardedCommand =
  | { kind: 'with-host-lock'; args: string[] }
  | { kind: 'agent-harness-config'; args: string[] }
  | { kind: 'pnpm-install'; args: string[] }
  | { kind: 'vitest-blob-manifest'; args: string[] }
  | { kind: 'vitest-report-attempt'; args: string[] }
  | { kind: 'prepare-vitest-reports'; args: string[] }
  | { kind: 'nuget-central-version'; args: string[] }
  | { kind: 'swift-semantic-equal'; args: string[] }
  | { kind: 'post-review'; args: string[] }
  | { kind: 'stage-review-payload'; args: string[] }
  | { kind: 'retrospective-transcript'; args: string[] }
  | { kind: 'retrospective-facts'; args: string[] }
  | { kind: 'agent-blackboard'; args: string[] }

export function parseForwardedCommand(
  command: string | undefined,
  args: string[],
): ForwardedCommand | undefined {
  if (command === 'with-host-lock') return { kind: 'with-host-lock', args }
  if (command === 'agent-harness-config') return { kind: 'agent-harness-config', args }
  if (command === 'pnpm-install') return { kind: 'pnpm-install', args }
  if (command === 'vitest-blob-manifest') return { kind: 'vitest-blob-manifest', args }
  if (command === 'vitest-report-attempt') return { kind: 'vitest-report-attempt', args }
  if (command === 'prepare-vitest-reports') return { kind: 'prepare-vitest-reports', args }
  if (command === 'nuget-central-version') return { kind: 'nuget-central-version', args }
  if (command === 'swift-semantic-equal') return { kind: 'swift-semantic-equal', args }
  if (command === 'post-review') return { kind: 'post-review', args }
  if (command === 'stage-review-payload') return { kind: 'stage-review-payload', args }
  if (command === 'retrospective-transcript') return { kind: 'retrospective-transcript', args }
  if (command === 'retrospective-facts') return { kind: 'retrospective-facts', args }
  if (command === 'agent-blackboard') return { kind: 'agent-blackboard', args }
  return undefined
}
