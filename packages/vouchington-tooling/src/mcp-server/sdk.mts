import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { isMissingModuleError } from '../agent-blackboard/client.mts'

/** The slice of `@modelcontextprotocol/sdk` this server uses, loaded only when `mcp` runs. */
export type McpSdk = {
  McpServer: typeof McpServer
  StdioServerTransport: typeof StdioServerTransport
  CallToolRequestSchema: typeof CallToolRequestSchema
  ListToolsRequestSchema: typeof ListToolsRequestSchema
}

export type SdkImporter = (specifier: string) => Promise<unknown>

const SDK_PACKAGE = '@modelcontextprotocol/sdk'

export const MISSING_SDK_MESSAGE =
  `vouchington mcp needs ${SDK_PACKAGE} (and its zod peer), which is an optional peer ` +
  `dependency of vouchington-tooling and is not installed. Install it next to ` +
  `vouchington-tooling: pnpm add -D ${SDK_PACKAGE} zod`

const defaultImporter: SdkImporter = (specifier) => import(specifier)

/**
 * Imports the SDK lazily. A static import would make every `vouchington` command fail on a
 * consumer that never installed the optional peer.
 */
export async function loadMcpSdk(importSdk: SdkImporter = defaultImporter): Promise<McpSdk> {
  try {
    const [server, stdio, types] = await Promise.all([
      importSdk(`${SDK_PACKAGE}/server/mcp.js`),
      importSdk(`${SDK_PACKAGE}/server/stdio.js`),
      importSdk(`${SDK_PACKAGE}/types.js`),
    ])
    return { ...(server as McpSdk), ...(stdio as McpSdk), ...(types as McpSdk) }
  } catch (error) {
    if (isMissingModuleError(error)) throw new Error(MISSING_SDK_MESSAGE, { cause: error })
    throw error
  }
}
