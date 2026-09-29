import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { callTool, type ServerEnvironment } from './dispatch.mts'
import type { McpSdk } from './sdk.mts'
import { TOOLS } from './tools.mts'

export const SERVER_NAME = 'vouchington-tooling'

const INSTRUCTIONS =
  'Journals agent-blackboard feedback for a vouchington consumer. Every tool takes an explicit ' +
  'sessionId and an optional worktree (an absolute path listed by `git worktree list` for the ' +
  'repository this server was launched from). Tool errors are actionable; do not fall back to a CLI.'

/**
 * Builds the server. The tool list and call handlers go on the low-level `server` because the
 * high-level `registerTool` path needs zod schemas, and this package keeps zod out of its own code.
 */
export function createMcpServer(
  sdk: McpSdk,
  environment: ServerEnvironment,
  version: string,
): McpServer {
  const mcp = new sdk.McpServer({ name: SERVER_NAME, version }, { instructions: INSTRUCTIONS })
  mcp.server.registerCapabilities({ tools: {} })
  mcp.server.setRequestHandler(sdk.ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }))
  mcp.server.setRequestHandler(sdk.CallToolRequestSchema, async (request) =>
    callTool(request.params.name, request.params.arguments, environment),
  )
  return mcp
}
