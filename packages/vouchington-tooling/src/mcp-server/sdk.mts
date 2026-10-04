import { createRequire } from 'node:module'
import { dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
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

/**
 * The directory the server was installed into: the parent of the outermost `node_modules` above
 * `from`, which is where `pnpm add` must run so the peers resolve from this package. Outside any
 * `node_modules` (a source checkout) it is the module's own directory.
 */
export function installDirectory(from: string | URL = import.meta.url): string {
  const file = typeof from === 'string' && !from.startsWith('file:') ? from : fileURLToPath(from)
  const marker = `${sep}node_modules${sep}`
  const index = file.indexOf(marker)
  return index === -1 ? dirname(file) : file.slice(0, index)
}

export function missingSdkMessage(directory: string): string {
  return (
    `vouchington mcp needs ${SDK_PACKAGE} (and its zod peer), which is an optional peer ` +
    `dependency of vouchington-tooling and is not installed. Install it in the directory ` +
    `vouchington-tooling is installed in, not in a project: cd ${directory} && ` +
    `pnpm add ${SDK_PACKAGE} zod`
  )
}

const defaultImporter: SdkImporter = (specifier) => import(specifier)

/**
 * Imports the SDK lazily. A static import would make every `vouchington` command fail on a
 * consumer that never installed the optional peer.
 */
export async function loadMcpSdk(
  importSdk: SdkImporter = defaultImporter,
  directory: string = installDirectory(),
): Promise<McpSdk> {
  try {
    const [server, stdio, types] = await Promise.all([
      importSdk(`${SDK_PACKAGE}/server/mcp.js`),
      importSdk(`${SDK_PACKAGE}/server/stdio.js`),
      importSdk(`${SDK_PACKAGE}/types.js`),
    ])
    return { ...(server as McpSdk), ...(stdio as McpSdk), ...(types as McpSdk) }
  } catch (error) {
    if (isMissingModuleError(error)) throw new Error(missingSdkMessage(directory), { cause: error })
    throw error
  }
}

export function missingBlackboardMessage(directory: string): string {
  return (
    'vouchington mcp needs agent-blackboard, which is an optional peer dependency of ' +
    'vouchington-tooling and is not installed. Install it in the directory vouchington-tooling ' +
    `is installed in, not in a project: cd ${directory} && pnpm add agent-blackboard`
  )
}

/** Fails fast at startup when `agent-blackboard` cannot be resolved from this package's install. */
export function assertBlackboardInstalled(resolveFrom: string | URL = import.meta.url): void {
  try {
    createRequire(resolveFrom).resolve('agent-blackboard')
  } catch (error) {
    // `resolve` only fails when the package cannot be found from `resolveFrom`.
    throw new Error(missingBlackboardMessage(installDirectory(resolveFrom)), { cause: error })
  }
}
