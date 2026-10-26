import type { ParsedCli } from './parse.mts'

type PolicyCli = Extract<
  ParsedCli,
  {
    kind:
      | 'coverage-scope-check'
      | 'trivy-policy'
      | 'docker-image-mirror'
      | 'workspace-registry-check'
  }
>

const POLICY_KINDS: ReadonlySet<string> = new Set<PolicyCli['kind']>([
  'coverage-scope-check',
  'trivy-policy',
  'docker-image-mirror',
  'workspace-registry-check',
])

export function isPolicyCli(parsed: ParsedCli): parsed is PolicyCli {
  return POLICY_KINDS.has(parsed.kind)
}

/** Lazily loads and runs a repository-file policy command. */
export function runPolicyCommand(parsed: PolicyCli): Promise<number> | number {
  switch (parsed.kind) {
    case 'coverage-scope-check':
      return import('./commands/coverage-scope-check.mts').then((command) =>
        command.runCoverageScopeCheckCommand(parsed.args),
      )
    case 'trivy-policy':
      return import('./commands/trivy-policy.mts').then((command) =>
        command.runTrivyPolicyCommand(parsed.args),
      )
    case 'docker-image-mirror':
      return import('./commands/docker-image-mirror.mts').then((command) =>
        command.runDockerImageMirrorCommand(parsed.args),
      )
    case 'workspace-registry-check':
      return import('./commands/workspace-registry-check.mts').then((command) =>
        command.runWorkspaceRegistryCheckCommand(parsed.args),
      )
  }
}
