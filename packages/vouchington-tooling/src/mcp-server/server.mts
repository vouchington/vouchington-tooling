import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { callTool, type ServerEnvironment } from './dispatch.mts'
import type { McpSdk } from './sdk.mts'
import { TOOLS } from './tools.mts'

export const SERVER_NAME = 'vouchington-tooling'

const INSTRUCTIONS =
  'Journals agent-blackboard feedback for a vouchington consumer. Every tool takes an explicit ' +
  'sessionId and an optional worktree (the absolute path of a git worktree top level; it ' +
  'defaults to the launch directory worktree and is required when the server was launched ' +
  'outside one). Hosts prefix the tool names differently: Claude ' +
  'Code mcp__vouchington-tooling__<tool>, Codex mcp__vouchington_tooling__<tool>, Grok ' +
  'vouchington-tooling__<tool> (through search_tool and use_tool), Cursor the vouchington-tooling ' +
  'namespace (through GetDynamicTools and CallDynamicTool). Search for journal_append before ' +
  'concluding this server is unavailable. Tool errors are actionable; do not fall back to a CLI.'

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
