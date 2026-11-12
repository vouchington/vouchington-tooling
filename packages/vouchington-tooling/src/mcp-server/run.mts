import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { loadClient, type BlackboardClientDependencies } from '../agent-blackboard/client.mts'
import type { RunTextCommand } from '../gh-cli/exec.mts'
import type { ServerEnvironment } from './dispatch.mts'
import { assertBlackboardInstalled, loadMcpSdk, type SdkImporter } from './sdk.mts'
import { captureInstall } from './install-info.mts'
import { createMcpServer } from './server.mts'
import { launchWorktreeRoot, runIsolatedGit } from './worktree.mts'

export type RunMcpServerOptions = {
  cwd: string
  env: NodeJS.ProcessEnv
  version: string
  importSdk?: SdkImporter
  runGit?: RunTextCommand
  /** Defaults to stdio. Tests pass one half of an in-memory pair. */
  transport?: Transport
  /** Test seam: where the startup check looks for `agent-blackboard`. Defaults to this module. */
  resolveFrom?: string | URL
  /** Test seam: replaces how the consumer's `agent-blackboard` client is loaded. */
  blackboard?: BlackboardClientDependencies
}

/**
 * Imports the agent-blackboard client once, at startup, and hands every tool call that module.
 * Re-importing per call would break a running server whose install directory was evicted.
 */
async function importBlackboard(
  resolveFrom: string | URL | undefined,
): Promise<BlackboardClientDependencies> {
  assertBlackboardInstalled(resolveFrom)
  // Resolve from this package's install, never the worktree, matching tool dispatch.
  const client = await loadClient({ resolveFrom: resolveFrom ?? import.meta.url })
  return { loadClient: () => Promise.resolve(client) }
}

/**
 * Starts the server and resolves once it is connected. Nothing on this path may write to stdout:
 * stdout is the protocol channel, so diagnostics go to stderr.
 */
export async function runMcpServer(options: RunMcpServerOptions): Promise<void> {
  const runGit = options.runGit ?? runIsolatedGit
  const sdk = await loadMcpSdk(options.importSdk)
  const blackboard = options.blackboard ?? (await importBlackboard(options.resolveFrom))
  const launchRoot = await launchWorktreeRoot(options.cwd, runGit)
  const environment: ServerEnvironment = {
    launchRoot,
    env: options.env,
    runGit,
    install: captureInstall(options.version),
    ...(options.resolveFrom === undefined ? {} : { resolveFrom: options.resolveFrom }),
    blackboard,
  }
  const server = createMcpServer(sdk, environment, options.version)
  /* v8 ignore next -- the stdio default is exercised by the spawned-process test */
  await server.connect(options.transport ?? new sdk.StdioServerTransport())
}
