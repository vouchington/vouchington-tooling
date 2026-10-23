import { runBrowserSession } from '../browser-session-runner/index.mts'
import {
  expiredAttempt,
  buildAttemptResult,
  failedSpawnAttempt,
  type AttemptResult,
} from './attempt-result.mts'
import { StorybookBrowserBootstrapTelemetry } from './bootstrap-telemetry.mts'
import type { StorybookBrowserDiagnostics } from './diagnostics.mts'
import { commandArgs, type StorybookBrowserRunnerOptions } from './options.mts'
import { OutputObserver } from './output-observer.mts'
import { createProjectOutputPatterns } from './output-patterns.mts'
import { quietOutputHeader, StorybookQuietOutput } from './quiet-output.mts'
import { DISABLED_STALL_TIMER_MS, createBrowserSessionDeps } from './session-deps.mts'
import type { ResolvedStorybookBrowserProject, StorybookBrowserRunnerDeps } from './types.mts'
import {
  createStorybookWatchdog,
  isSpawnedProcessGroupId,
  sampleCompletionFile,
  type WatchdogOutcome,
} from './watchdog.mts'

export type RunAttemptInput = {
  deps: StorybookBrowserRunnerDeps
  diagnostics: StorybookBrowserDiagnostics
  env: NodeJS.ProcessEnv
  options: StorybookBrowserRunnerOptions
  project: ResolvedStorybookBrowserProject
  sessionDeadlineAt: number
}

/** Runs the test command once under `runBrowserSession` and classifies how it ended. */
export async function runUpstreamAttempt(input: RunAttemptInput): Promise<AttemptResult> {
  const { deps, diagnostics, env, options, project, sessionDeadlineAt } = input
  const startedAt = deps.now()
  const telemetry = new StorybookBrowserBootstrapTelemetry()
  const quietOutput = new StorybookQuietOutput(project.progressPrefix)
  const observer = new OutputObserver({
    diagnostics,
    now: deps.now,
    patterns: createProjectOutputPatterns(project.projectName),
    progressPrefix: project.progressPrefix,
    quietOutput,
    startedAt,
    stderr: deps.stderr,
    stdout: deps.stdout,
    telemetry,
  })
  const outcome: WatchdogOutcome = {
    hung: false,
    resultFileDetectedAt: null,
    semanticStall: false,
    stalled: false,
  }
  let spawnFailed = false
  let processGroupId: number | undefined
  let completed: AttemptResult | undefined
  const replayQuietOutput = () => {
    const quiet = quietOutput.drain()
    if (!quiet) return
    deps.stderr.write(quietOutputHeader(Buffer.byteLength(quiet)))
    deps.stdout.write(quiet)
  }
  // browser-session-runner needs an integer delay; a monotonic clock yields fractions.
  const remainingMs = Math.max(
    1,
    Math.ceil(sessionDeadlineAt - options.terminationGraceMs - deps.now()),
  )
  try {
    await runBrowserSession(
      {
        attempts: 1,
        classifyExit: () => (completed?.retryable ? 'retry' : 'return'),
        deadlineMs: remainingMs,
        graceMs: options.terminationGraceMs,
        onAttemptComplete: (session) => {
          observer.flush()
          sampleCompletionFile({ completionFile: project.completionFile, deps, outcome })
          const cleanExit =
            session.reason === 'exit' && session.exit.code === 0 && !session.exit.signal
          if (!cleanExit || spawnFailed) replayQuietOutput()
          completed = buildAttemptResult(session, {
            bootstrap: telemetry.snapshot(),
            finishedAt: deps.now(),
            observed: observer.snapshot(),
            outcome,
            spawnFailed,
            startedAt,
          })
        },
        onLine: () => undefined,
        onOutput: ({ chunk, source }) => observer.observe(source, chunk),
        processGroupDrainMs: options.terminationGraceMs,
        semanticStallMs: DISABLED_STALL_TIMER_MS,
        start: () => {
          const started = spawnTestCommand(project, env, deps, () => {
            spawnFailed = true
          })
          processGroupId = started.processGroupId
          return started
        },
        startupStallMs: DISABLED_STALL_TIMER_MS,
        watchdog: createStorybookWatchdog({
          completionFile: project.completionFile,
          deps,
          hangMs: options.hangMs,
          observer,
          outcome,
          processGroupId: () => processGroupId,
          stallMs: options.stallMs,
        }),
      },
      createBrowserSessionDeps(deps),
    )
  } catch (error) {
    if (!spawnFailed) throw error
    completed = failedSpawnAttempt(
      telemetry.snapshot(),
      startedAt,
      observer.snapshot().lastOutputAt,
      deps.now(),
    )
  }
  return completed ?? expiredAttempt(telemetry.snapshot(), startedAt, deps.now())
}

function spawnTestCommand(
  project: ResolvedStorybookBrowserProject,
  env: NodeJS.ProcessEnv,
  deps: StorybookBrowserRunnerDeps,
  onSpawnFailure: () => void,
) {
  const child = deps.spawn(project.command, commandArgs(project, env), {
    cwd: deps.cwd,
    detached: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.on('error', (error) => {
    onSpawnFailure()
    deps.stderr.write(
      `[storybook-browser] failed to start browser test command: ${error.message}\n`,
    )
  })
  const processGroupId = child.pid
  if (!isSpawnedProcessGroupId(processGroupId)) {
    onSpawnFailure()
    deps.stderr.write(
      '[storybook-browser] failed to start browser test command: spawned browser test command without a process ID\n',
    )
    throw new Error('spawned browser test command without a process ID')
  }
  return Object.assign(child, { processGroupId })
}
