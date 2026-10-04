import { createRequire } from 'node:module'
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

export const MISSING_BLACKBOARD_MESSAGE =
  'vouchington mcp needs agent-blackboard, which is an optional peer dependency of ' +
  'vouchington-tooling and is not installed. Install it next to vouchington-tooling: ' +
  'pnpm add -D agent-blackboard'

/** Fails fast at startup when `agent-blackboard` cannot be resolved from this package's install. */
export function assertBlackboardInstalled(resolveFrom: string | URL = import.meta.url): void {
  try {
    createRequire(resolveFrom).resolve('agent-blackboard')
  } catch (error) {
    // `resolve` only fails when the package cannot be found from `resolveFrom`.
    throw new Error(MISSING_BLACKBOARD_MESSAGE, { cause: error })
  }
}
