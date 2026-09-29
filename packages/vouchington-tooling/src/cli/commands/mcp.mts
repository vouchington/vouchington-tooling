import { runMcpServer } from '../../mcp-server/run.mts'
import { readInstalledVersion } from '../installed-version.mts'

/**
 * `vouchington mcp`: serves the agent-blackboard journal tools over stdio. It resolves once the
 * server is connected; the open stdin keeps the process alive until the client disconnects.
 */
export async function runMcpCommand(args: string[]): Promise<number> {
  try {
    if (args.length > 0)
      throw new Error('usage: vouchington mcp (takes no arguments; it serves stdio)')
    await runMcpServer({ cwd: process.cwd(), env: process.env, version: readInstalledVersion() })
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
