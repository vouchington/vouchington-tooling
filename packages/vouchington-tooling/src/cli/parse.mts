import {
  parseGhaArtifactsCleanup,
  type ParsedGhaArtifactsCleanup,
} from './parse-gha-artifacts-cleanup.mts'
import { parseGhaRuntimeAudit, type ParsedGhaRuntimeAudit } from './parse-gha-runtime-audit.mts'
import {
  parseAstGrepExamples,
  parseGhaWorkspacePolicy,
  parseGitleaksDirectoryScan,
  parseHttpOrigin,
  parseLinkSkill,
  parseRequireUpToDate,
  parseRunnerPortPolicy,
} from './parse-options.mts'

export type ParsedCli =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string }
  | { kind: 'runner-port-policy'; file?: string; reserved?: number }
  | { kind: 'with-host-lock'; args: string[] }
  | { kind: 'script'; command: ScriptCommand; args: string[] }
  | { kind: 'pnpm-install'; args: string[] }
  | { kind: 'vitest-blob-manifest'; args: string[] }
  | { kind: 'vitest-report-attempt'; args: string[] }
  | { kind: 'prepare-vitest-reports'; args: string[] }
  | { kind: 'nuget-central-version'; args: string[] }
  | { kind: 'swift-semantic-equal'; args: string[] }
  | { kind: 'post-review'; args: string[] }
  | { kind: 'stage-review-payload'; args: string[] }
  | { kind: 'http-origin'; field: string; value: string }
  | { kind: 'retrospective-transcript'; args: string[] }
  | { kind: 'link-skill'; name: string; sourceRoot: string; targetRoot: string }
  | { kind: 'retrospective-facts'; args: string[] }
  | { kind: 'agent-blackboard'; args: string[] }
  | { kind: 'require-up-to-date'; remote: string; branch: string }
  | { kind: 'gitleaks-directory-scan'; config: string; directory?: string }
  | { kind: 'ast-grep-examples'; rules: string; config: string }
  | {
      kind: 'gha-workspace-policy'
      root?: string
      workflowDirectories?: string[]
      actionDirectories?: string[]
    }
  | ParsedGhaRuntimeAudit
  | ParsedGhaArtifactsCleanup

export type ScriptCommand =
  | 'gha-output'
  | 'gha-needs-results'
  | 'download-with-diagnostics'
  | 'download-optional-run-artifacts'
  | 'host-pressure-diagnostics'
  | 'allocate-browser-safe-ports'
  | 'diagnose-port-collision'
  | 'prepare-trivy-db'
  | 'check-cache-size'
  | 'make-shard-matrix'
  | 'load-runner-env'
  | 'clean-workspace'
  | 'install-github-release'
  | 'run-with-timeout'
  | 'lint-links'
  | 'materialize-pr-context'
  | 'wait-for-apt-locks'
  | 'install-playwright-chromium-arm64'
  | 'ghcr-package-retention'
  | 'harness-admission-lane'
  | 'harness-assert-gates'

const SCRIPT_COMMANDS = new Set<ScriptCommand>([
  'gha-output',
  'gha-needs-results',
  'download-with-diagnostics',
  'download-optional-run-artifacts',
  'host-pressure-diagnostics',
  'allocate-browser-safe-ports',
  'diagnose-port-collision',
  'prepare-trivy-db',
  'check-cache-size',
  'make-shard-matrix',
  'load-runner-env',
  'clean-workspace',
  'install-github-release',
  'run-with-timeout',
  'lint-links',
  'materialize-pr-context',
  'wait-for-apt-locks',
  'install-playwright-chromium-arm64',
  'ghcr-package-retention',
  'harness-admission-lane',
  'harness-assert-gates',
])

export function parseCli(argv: readonly string[]): ParsedCli {
  const args = argv.slice(2)
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') return { kind: 'help' }
  if (args[0] === '--version' || args[0] === '-v') return { kind: 'version' }

  const [command, ...rest] = args
  if (command === 'runner-port-policy') return parseRunnerPortPolicy(rest)
  if (command === 'with-host-lock') return { kind: 'with-host-lock', args: rest }
  if (command === 'gha-runtime-audit') return parseGhaRuntimeAudit(rest)
  if (command === 'pnpm-install') return { kind: 'pnpm-install', args: rest }
  if (command === 'vitest-blob-manifest') return { kind: 'vitest-blob-manifest', args: rest }
  if (command === 'vitest-report-attempt') return { kind: 'vitest-report-attempt', args: rest }
  if (command === 'prepare-vitest-reports') return { kind: 'prepare-vitest-reports', args: rest }
  if (command === 'nuget-central-version') return { kind: 'nuget-central-version', args: rest }
  if (command === 'swift-semantic-equal') return { kind: 'swift-semantic-equal', args: rest }
  if (command === 'post-review') return { kind: 'post-review', args: rest }
  if (command === 'stage-review-payload') return { kind: 'stage-review-payload', args: rest }
  if (command === 'http-origin') return parseHttpOrigin(rest)
  if (command === 'retrospective-transcript')
    return { kind: 'retrospective-transcript', args: rest }
  if (command === 'link-skill') return parseLinkSkill(rest)
  if (command === 'retrospective-facts') return { kind: 'retrospective-facts', args: rest }
  if (command === 'agent-blackboard') return { kind: 'agent-blackboard', args: rest }
  if (command === 'require-up-to-date') return parseRequireUpToDate(rest)
  if (command === 'gitleaks-directory-scan') return parseGitleaksDirectoryScan(rest)
  if (command === 'ast-grep-examples') return parseAstGrepExamples(rest)
  if (command === 'gha-workspace-policy') return parseGhaWorkspacePolicy(rest)
  if (command === 'gha-artifacts-cleanup') return parseGhaArtifactsCleanup(rest)
  if (command !== undefined && SCRIPT_COMMANDS.has(command as ScriptCommand)) {
    return { kind: 'script', command: command as ScriptCommand, args: rest }
  }
  return { kind: 'error', message: `unknown command: ${command}` }
}
