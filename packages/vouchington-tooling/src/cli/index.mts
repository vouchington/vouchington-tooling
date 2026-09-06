#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runAgentHarnessConfigCli } from '../agent-harness-config/cli.mts'
import { runPostReviewCli } from '../gha-post-review/cli.mts'
import { runStageReviewPayloadCli } from '../gha-review-payload/cli.mts'
import { readPackageVersion } from '../package-version.mts'
import { runSwiftSemanticEqualCli } from '../swift-semantic-equal/cli.mts'
import { runGhaArtifactsCleanup } from './commands/gha-artifacts-cleanup.mts'
import { runGhaRuntimeAudit } from './commands/gha-runtime-audit.mts'
import { runHttpOrigin } from './commands/http-origin.mts'
import { runPnpmInstallCli } from './commands/pnpm-install.mts'
import { runRunnerPortPolicy } from './commands/runner-port-policy.mts'
import { runScript } from './commands/spawn-script.mts'
import { runNugetCentralVersionCommand } from './commands/nuget-central-version.mts'
import { runVitestBlobManifestCommand } from './commands/vitest-blob-manifest.mts'
import { runVitestReportAttemptCommand } from './commands/vitest-report-attempt.mts'
import { runPrepareVitestReportsCommand } from './commands/prepare-vitest-reports.mts'
import { runRetrospectiveTranscriptCommand } from './commands/retrospective-transcript.mts'
import { runLinkSkill } from './commands/link-skill.mts'
import { runRetrospectiveFactsCommand } from './commands/retrospective-facts.mts'
import { runAgentBlackboardCommand } from './commands/agent-blackboard.mts'
import { runWithHostLock } from './commands/with-host-lock.mts'
import { runRequireUpToDate } from './commands/require-up-to-date.mts'
import { runAstGrepExamplesCommand } from './commands/ast-grep-examples.mts'
import { runAstGrepPackCommand } from './commands/ast-grep-pack.mts'
import { runGhaWorkspacePolicy } from './commands/gha-workspace-policy.mts'
import { parseCli, type ScriptCommand } from './parse.mts'
import { packageScriptPath } from './script-path.mts'
import { printUsage } from './usage.mts'

const SCRIPT_PATHS: Record<ScriptCommand, { command: string; path: string }> = {
  'gha-output': { command: 'bash', path: 'scripts/gha/write-github-multiline-output.sh' },
  'gha-needs-results': { command: 'bash', path: 'scripts/gha/check-needs-results.sh' },
  'download-with-diagnostics': {
    command: 'bash',
    path: 'scripts/gha/download-with-diagnostics.sh',
  },
  'download-optional-run-artifacts': {
    command: 'bash',
    path: 'scripts/gha/download-optional-run-artifacts.sh',
  },
  'host-pressure-diagnostics': {
    command: 'bash',
    path: 'scripts/gha/host-pressure-diagnostics.sh',
  },
  'allocate-browser-safe-ports': {
    command: 'python3',
    path: 'scripts/allocate-browser-safe-ports.py',
  },
  'diagnose-port-collision': {
    command: 'bash',
    path: 'scripts/gha/diagnose-port-collision.sh',
  },
  'prepare-trivy-db': { command: 'bash', path: 'scripts/gha/prepare-trivy-db.sh' },
  'check-cache-size': { command: 'bash', path: 'scripts/gha/check-cache-size.sh' },
  'make-shard-matrix': { command: 'bash', path: 'scripts/gha/make-shard-matrix.sh' },
  'load-runner-env': { command: 'bash', path: 'scripts/gha/load-runner-env.sh' },
  'clean-workspace': { command: 'bash', path: 'scripts/gha/clean-workspace.sh' },
  'install-github-release': { command: 'bash', path: 'scripts/gha/install-github-release.sh' },
  'run-with-timeout': { command: 'bash', path: 'scripts/gha/run-with-timeout.sh' },
  'lint-links': { command: 'bash', path: 'scripts/gha/lint-links.sh' },
  'materialize-pr-context': { command: 'bash', path: 'scripts/gha/materialize-pr-context.sh' },
  'wait-for-apt-locks': { command: 'bash', path: 'scripts/gha/wait-for-apt-locks.sh' },
  'install-playwright-chromium-arm64': {
    command: 'bash',
    path: 'scripts/gha/install-playwright-chromium-arm64.sh',
  },
  'ghcr-package-retention': { command: 'bash', path: 'scripts/gha/ghcr-package-retention.sh' },
  'harness-admission-lane': {
    command: 'bash',
    path: 'scripts/gha/harness-admission-lane.sh',
  },
  'harness-assert-gates': { command: 'bash', path: 'scripts/gha/harness-assert-gates.sh' },
}

export function runCli(argv: readonly string[] = process.argv): number | Promise<number> {
  const parsed = parseCli(argv)
  switch (parsed.kind) {
    case 'help':
      printUsage()
      return 0
    case 'version':
      process.stdout.write(`${readInstalledVersion()}\n`)
      return 0
    case 'error':
      process.stderr.write(`vouchington: ${parsed.message}\n`)
      printUsage(process.stderr)
      return 2
    case 'runner-port-policy':
      return runRunnerPortPolicy(parsed)
    case 'with-host-lock':
      return runWithHostLock(parsed.args)
    case 'agent-harness-config':
      return runAgentHarnessConfigCli(parsed.args)
    case 'gha-runtime-audit':
      return runGhaRuntimeAudit(parsed)
    case 'script': {
      const spec = SCRIPT_PATHS[parsed.command]
      return runScript(spec.command, packageScriptPath(spec.path), parsed.args)
    }
    case 'pnpm-install':
      return runPnpmInstallCli(parsed.args)
    case 'vitest-blob-manifest':
      return runVitestBlobManifestCommand(parsed.args)
    case 'vitest-report-attempt':
      return runVitestReportAttemptCommand(parsed.args)
    case 'prepare-vitest-reports':
      return runPrepareVitestReportsCommand(parsed.args)
    case 'nuget-central-version':
      return runNugetCentralVersionCommand(parsed.args)
    case 'swift-semantic-equal':
      return runSwiftSemanticEqualCli(parsed.args)
    case 'post-review':
      return runPostReviewCli()
    case 'stage-review-payload':
      return runStageReviewPayloadCli(parsed.args)
    case 'http-origin':
      return runHttpOrigin(parsed.field, parsed.value)
    case 'gha-artifacts-cleanup':
      return runGhaArtifactsCleanup(parsed)
    case 'retrospective-transcript':
      return runRetrospectiveTranscriptCommand(parsed.args)
    case 'link-skill':
      return runLinkSkill(parsed)
    case 'retrospective-facts':
      return runRetrospectiveFactsCommand(parsed.args)
    case 'agent-blackboard':
      return runAgentBlackboardCommand(parsed.args)
    case 'require-up-to-date':
      return runRequireUpToDate(parsed)
    case 'gitleaks-directory-scan':
      return runScript('bash', packageScriptPath('scripts/gitleaks-directory-scan.sh'), [
        '--config',
        parsed.config,
        ...(parsed.directory === undefined ? [] : ['--root', parsed.directory]),
      ])
    case 'ast-grep-examples':
      return runAstGrepExamplesCommand(parsed)
    case 'ast-grep-pack':
      return runAstGrepPackCommand()
    case 'gha-workspace-policy':
      return runGhaWorkspacePolicy(parsed)
  }
}

function readInstalledVersion(): string {
  return readPackageVersion(
    JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')),
  )
}

export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false
  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href
  } catch {
    return metaUrl === pathToFileURL(resolve(argv1)).href
  }
}

/* v8 ignore next 8 */
if (isMainModule(import.meta.url, process.argv[1])) {
  const result = runCli()
  if (typeof result === 'number') process.exitCode = result
  else {
    result.then(
      (code) => {
        process.exitCode = code
      },
      (error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exitCode = 1
      },
    )
  }
}
