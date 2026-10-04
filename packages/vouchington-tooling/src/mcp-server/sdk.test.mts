import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import {
  assertBlackboardInstalled,
  installDirectory,
  loadMcpSdk,
  missingBlackboardMessage,
  missingSdkMessage,
} from './sdk.mts'

describe('assertBlackboardInstalled', () => {
  it("resolves agent-blackboard from this package's own location by default", () => {
    expect(() => assertBlackboardInstalled()).not.toThrow()
  })

  it('names the package to install when it cannot be resolved', () => {
    const from = join(tmpdir(), 'vouchington-no-such-install', 'server.mjs')
    expect(() => assertBlackboardInstalled(from)).toThrow(missingBlackboardMessage(dirname(from)))
    expect(missingBlackboardMessage('/m')).toContain('cd /m && pnpm add agent-blackboard')
  })

  it('names the install directory of the server, not the worktree, in the message', () => {
    const from = join(tmpdir(), 'machine', 'node_modules', 'vouchington-tooling', 'dist', 'x.mjs')
    expect(() => assertBlackboardInstalled(from)).toThrow(`cd ${join(tmpdir(), 'machine')} &&`)
  })
})

describe('installDirectory', () => {
  it('is the parent of the outermost node_modules, for paths and file URLs', () => {
    const file = join('/m', 'node_modules', '.pnpm', 'v@1', 'node_modules', 'v', 'dist', 'sdk.mjs')
    expect(installDirectory(file)).toBe('/m')
    expect(installDirectory(pathToFileURL(file))).toBe('/m')
    expect(installDirectory(pathToFileURL(file).href)).toBe('/m')
  })

  it('is the module directory outside any node_modules, and defaults to this module', () => {
    expect(installDirectory(join('/src', 'mcp-server', 'sdk.mts'))).toBe(join('/src', 'mcp-server'))
    expect(installDirectory()).toBe(dirname(fileURLToPath(import.meta.url)))
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
      }, '/machine')
      await expect(rejection).rejects.toThrow(missingSdkMessage('/machine'))
      await expect(rejection).rejects.toMatchObject({ cause: missing })
    }
    expect(missingSdkMessage('/machine')).toContain(
      'cd /machine && pnpm add @modelcontextprotocol/sdk zod',
    )
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
