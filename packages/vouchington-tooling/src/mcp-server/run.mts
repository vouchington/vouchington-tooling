import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { BlackboardClientDependencies } from '../agent-blackboard/client.mts'
import type { RunTextCommand } from '../gh-cli/exec.mts'
import type { ServerEnvironment } from './dispatch.mts'
import { loadMcpSdk, type SdkImporter } from './sdk.mts'
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
  /** Test seam: replaces how the consumer's `agent-blackboard` client is loaded. */
  blackboard?: BlackboardClientDependencies
}

/**
 * Starts the server and resolves once it is connected. Nothing on this path may write to stdout:
 * stdout is the protocol channel, so diagnostics go to stderr.
 */
export async function runMcpServer(options: RunMcpServerOptions): Promise<void> {
  const runGit = options.runGit ?? runIsolatedGit
  const sdk = await loadMcpSdk(options.importSdk)
  const launchRoot = await launchWorktreeRoot(options.cwd, runGit)
  const environment: ServerEnvironment = {
    launchRoot,
    env: options.env,
    runGit,
    ...(options.blackboard === undefined ? {} : { blackboard: options.blackboard }),
  }
  const server = createMcpServer(sdk, environment, options.version)
  /* v8 ignore next -- the stdio default is exercised by the spawned-process test */
  await server.connect(options.transport ?? new sdk.StdioServerTransport())
}
