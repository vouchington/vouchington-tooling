import {
  parseGhaArtifactsCleanup,
  type ParsedGhaArtifactsCleanup,
} from './parse-gha-artifacts-cleanup.mts'
import { parseGhaRuntimeAudit, type ParsedGhaRuntimeAudit } from './parse-gha-runtime-audit.mts'

export type ParsedCli =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string }
  | { kind: 'runner-port-policy'; file?: string; reserved?: number }
  | { kind: 'with-host-lock'; args: string[] }
  | { kind: 'script'; command: ScriptCommand; args: string[] }
  | { kind: 'pnpm-install'; args: string[] }
  | { kind: 'vitest-blob-manifest'; args: string[] }
  | { kind: 'nuget-central-version'; args: string[] }
  | { kind: 'swift-semantic-equal'; args: string[] }
  | { kind: 'post-review'; args: string[] }
  | { kind: 'stage-review-payload'; args: string[] }
  | { kind: 'http-origin'; field: string; value: string }
  | { kind: 'retrospective-transcript'; args: string[] }
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
  if (command === 'nuget-central-version') return { kind: 'nuget-central-version', args: rest }
  if (command === 'swift-semantic-equal') return { kind: 'swift-semantic-equal', args: rest }
  if (command === 'post-review') return { kind: 'post-review', args: rest }
  if (command === 'stage-review-payload') return { kind: 'stage-review-payload', args: rest }
  if (command === 'http-origin') return parseHttpOrigin(rest)
  if (command === 'retrospective-transcript')
    return { kind: 'retrospective-transcript', args: rest }
  if (command === 'gha-artifacts-cleanup') return parseGhaArtifactsCleanup(rest)
  if (command !== undefined && SCRIPT_COMMANDS.has(command as ScriptCommand)) {
    return { kind: 'script', command: command as ScriptCommand, args: rest }
  }
  return { kind: 'error', message: `unknown command: ${command}` }
}

function parseRunnerPortPolicy(args: readonly string[]): ParsedCli {
  let file: string | undefined
  let reserved: number | undefined
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--file') {
      const value = args[index + 1]
      if (value === undefined) return { kind: 'error', message: '--file requires a path' }
      file = value
      index += 1
      continue
    }
    if (flag === '--reserved') {
      const value = args[index + 1]
      if (value === undefined) return { kind: 'error', message: '--reserved requires a port' }
      const port = Number(value)
      if (!Number.isInteger(port))
        return { kind: 'error', message: '--reserved must be an integer' }
      reserved = port
      index += 1
      continue
    }
    if (flag === '--help' || flag === '-h') return { kind: 'help' }
    return { kind: 'error', message: `unknown runner-port-policy option: ${flag}` }
  }
  return {
    kind: 'runner-port-policy',
    ...(file === undefined ? {} : { file }),
    ...(reserved === undefined ? {} : { reserved }),
  }
}

function parseHttpOrigin(args: readonly string[]): ParsedCli {
  let field = 'origin'
  const values: string[] = []
  let index = 0
  while (index < args.length) {
    const flag = args[index]!
    index += 1
    if (flag === '--help' || flag === '-h') return { kind: 'help' }
    if (flag === '--field') {
      const value = args[index]
      if (value === undefined) return { kind: 'error', message: '--field requires a name' }
      field = value
      index += 1
      continue
    }
    if (flag === '--') {
      values.push(...args.slice(index))
      break
    }
    if (flag.startsWith('-'))
      return { kind: 'error', message: `unknown http-origin option: ${flag}` }
    values.push(flag)
  }
  if (values.length > 1) return { kind: 'error', message: 'http-origin accepts at most one value' }
  return { kind: 'http-origin', field, value: values[0] ?? '' }
}
