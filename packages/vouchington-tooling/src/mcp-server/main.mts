import { runMcpCommand } from '../cli/commands/mcp.mts'

/**
 * Entry of `bin/vouchington-mcp.mjs`: starts the server without parsing CLI arguments and records
 * the exit code. The open stdin keeps the process alive after a successful start.
 */
export async function runMcpMain(): Promise<void> {
  process.exitCode = await runMcpCommand([])
}
