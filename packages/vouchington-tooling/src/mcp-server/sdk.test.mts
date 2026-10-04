import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MISSING_BLACKBOARD_MESSAGE,
  MISSING_SDK_MESSAGE,
  assertBlackboardInstalled,
  loadMcpSdk,
} from './sdk.mts'

describe('assertBlackboardInstalled', () => {
  it("resolves agent-blackboard from this package's own location by default", () => {
    expect(() => assertBlackboardInstalled()).not.toThrow()
  })

  it('names the package to install when it cannot be resolved', () => {
    const from = join(tmpdir(), 'vouchington-no-such-install', 'server.mjs')
    expect(() => assertBlackboardInstalled(from)).toThrow(MISSING_BLACKBOARD_MESSAGE)
    expect(MISSING_BLACKBOARD_MESSAGE).toContain('pnpm add -D agent-blackboard')
  })
})

describe('loadMcpSdk', () => {
  it('loads the server pieces from the installed SDK', async () => {
    const sdk = await loadMcpSdk()
    expect(typeof sdk.McpServer).toBe('function')
    expect(typeof sdk.StdioServerTransport).toBe('function')
    expect(sdk.CallToolRequestSchema).toBeDefined()
    expect(sdk.ListToolsRequestSchema).toBeDefined()
  })

  it('names the package to install when the optional peer is missing', async () => {
    for (const code of ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND']) {
      const missing = Object.assign(new Error("Cannot find package '@modelcontextprotocol/sdk'"), {
        code,
      })
      const rejection = loadMcpSdk(async () => {
        throw missing
      })
      await expect(rejection).rejects.toThrow(MISSING_SDK_MESSAGE)
      await expect(rejection).rejects.toMatchObject({ cause: missing })
    }
    expect(MISSING_SDK_MESSAGE).toContain('@modelcontextprotocol/sdk')
    expect(MISSING_SDK_MESSAGE).toContain('zod')
    expect(MISSING_SDK_MESSAGE).toContain('pnpm add -D')
  })

  it('rethrows any other import failure unchanged', async () => {
    const broken = new SyntaxError('unexpected token')
    await expect(
      loadMcpSdk(async () => {
        throw broken
      }),
    ).rejects.toBe(broken)
  })
})
