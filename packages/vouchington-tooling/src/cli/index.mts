#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runPostReviewCli } from '../gha-post-review/cli.mts'
import { runStageReviewPayloadCli } from '../gha-review-payload/cli.mts'
import { runSwiftSemanticEqualCli } from '../swift-semantic-equal/cli.mts'
import { runAgentIssueLabels } from './commands/agent-issue-labels.mts'
import { runGhaArtifactsCleanup } from './commands/gha-artifacts-cleanup.mts'
import { runGhaRuntimeAudit } from './commands/gha-runtime-audit.mts'
import { runGitleaksDirectoryScanCommand } from './commands/gitleaks-directory-scan.mts'
import { runHttpOrigin } from './commands/http-origin.mts'
import { runPnpmInstallCli } from './commands/pnpm-install.mts'
import { runRunnerPortPolicy } from './commands/runner-port-policy.mts'
import { runScript } from './commands/spawn-script.mts'
import { runNugetCentralVersionCommand } from './commands/nuget-central-version.mts'
import { runDeadCodeCli } from '../dead-code/cli.mts'
import { runVerifyWorkflowSecretsCli } from '../workflow-secrets-drift/cli.mts'
import { runVitestBlobManifestCommand } from './commands/vitest-blob-manifest.mts'
import { runVitestReportAttemptCommand } from './commands/vitest-report-attempt.mts'
import { runPrepareVitestReportsCommand } from './commands/prepare-vitest-reports.mts'
import { runRetrospectiveTranscriptCommand } from './commands/retrospective-transcript.mts'
import { runLinkSkill } from './commands/link-skill.mts'
import { runRetrospectiveFactsCommand } from './commands/retrospective-facts.mts'
import { runAgentBlackboardCommand } from './commands/agent-blackboard.mts'
import { runHookCommand } from './commands/hook.mts'
import { runMcpCommand } from './commands/mcp.mts'
import { runWorktreeCommand } from './commands/worktree.mts'
import { runTmuxCommand } from '../tmux/cli.mts'
import { runHostStoragePreflightCli } from '../host-storage/cli.mts'
import { runWithHostLock } from './commands/with-host-lock.mts'
import { runFreshBase } from './commands/fresh-base.mts'
import { runRequireUpToDate } from './commands/require-up-to-date.mts'
import { runAstGrepExamplesCommand } from './commands/ast-grep-examples.mts'
import { runAstGrepPackCommand } from './commands/ast-grep-pack.mts'
import { runGhaWorkspacePolicy } from './commands/gha-workspace-policy.mts'
import { readInstalledVersion } from './installed-version.mts'
import { parseCli } from './parse.mts'
import { SCRIPT_PATHS } from './script-paths.mts'
import { runStoryCoverageLazy } from './story-coverage-lazy.mts'
import { packageScriptPath } from './script-path.mts'
import { commandUsage, printUsage } from './usage.mts'

export function runCli(argv: readonly string[] = process.argv): number | Promise<number> {
  const parsed = parseCli(argv)
  switch (parsed.kind) {
    case 'help':
      printUsage()
      return 0
    case 'command-help':
      process.stdout.write(commandUsage(parsed.command))
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
    case 'host-storage':
      return runHostStoragePreflightCli(parsed.args)
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
    case 'verify-workflow-secrets':
      return runVerifyWorkflowSecretsCli(parsed.args)
    case 'dead-code':
      return runDeadCodeCli(parsed.args)
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
    case 'agent-issue-labels':
      return runAgentIssueLabels(parsed)
    case 'story-coverage':
      return runStoryCoverageLazy(parsed)
    case 'retrospective-transcript':
      return runRetrospectiveTranscriptCommand(parsed.args)
    case 'link-skill':
      return runLinkSkill(parsed)
    case 'retrospective-facts':
      return runRetrospectiveFactsCommand(parsed.args)
    case 'agent-blackboard':
      return runAgentBlackboardCommand(parsed.args)
    case 'mcp':
      return runMcpCommand(parsed.args)
    case 'transient-retry':
      return import('./commands/transient-retry.mts').then((command) =>
        command.runTransientRetryCommand(parsed.args),
      )
    case 'sandbox-command-audit':
      return import('./commands/sandbox-command-audit.mts').then((command) =>
        command.runSandboxCommandAuditCommand(parsed.args),
      )
    case 'coverage-scope-check':
      return import('./commands/coverage-scope-check.mts').then((command) =>
        command.runCoverageScopeCheckCommand(parsed.args),
      )
    case 'cloc':
      return import('./commands/cloc.mts').then((command) => command.runClocCommand(parsed.args))
    case 'trivy-policy':
      return import('./commands/trivy-policy.mts').then((command) =>
        command.runTrivyPolicyCommand(parsed.args),
      )
    case 'docker-image-mirror':
      return import('./commands/docker-image-mirror.mts').then((command) =>
        command.runDockerImageMirrorCommand(parsed.args),
      )
    case 'storybook-browser-runner':
      return import('./commands/storybook-browser-runner.mts').then((command) =>
        command.runStorybookBrowserRunnerCommand(parsed.args),
      )
    case 'hook':
      return runHookCommand(parsed.args)
    case 'worktree':
      return runWorktreeCommand(parsed.args)
    case 'tmux':
      return runTmuxCommand(parsed.args)
    case 'require-up-to-date':
      return runRequireUpToDate(parsed)
    case 'fresh-base':
      return runFreshBase(parsed)
    case 'gitleaks-directory-scan':
      return runGitleaksDirectoryScanCommand(parsed)
    case 'ast-grep-examples':
      return runAstGrepExamplesCommand(parsed)
    case 'ast-grep-pack':
      return runAstGrepPackCommand()
    case 'gha-workspace-policy':
      return runGhaWorkspacePolicy(parsed)
  }
}

export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false
  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href
  } catch {
    return metaUrl === pathToFileURL(resolve(argv1)).href
  }
}

/** Runs the CLI and records its exit code. `bin/vouchington.mjs` calls this after its Node check. */
export async function runMain(
  argv: readonly string[] = process.argv,
  run: typeof runCli = runCli,
): Promise<void> {
  try {
    process.exitCode = await run(argv)
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

/* v8 ignore next 3 */
if (isMainModule(import.meta.url, process.argv[1])) {
  void runMain()
}
