import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  bin: Record<string, string>
  exports: Record<string, unknown>
  files: string[]
}

/** The path machines register. Changing it breaks every installed harness, so it is pinned. */
const ENTRY = 'bin/vouchington-mcp.mjs'

describe('the published MCP server entry point', () => {
  it('is bin/vouchington-mcp.mjs, a bin and an export, shipped in the package', () => {
    expect(manifest.bin['vouchington-mcp']).toBe(ENTRY)
    expect(manifest.exports['./mcp-server/bin']).toBe(`./${ENTRY}`)
    expect(manifest.files).toContain('bin')
    expect(statSync(join(packageRoot, ENTRY)).mode & 0o111).not.toBe(0)
  })

  it('hands over to dist/mcp-server/main.mjs, which builds from src/mcp-server/main.mts', () => {
    const shim = readFileSync(join(packageRoot, ENTRY), 'utf8')
    expect(shim).toContain("import('../dist/mcp-server/main.mjs')")
    expect(existsSync(join(packageRoot, 'src', 'mcp-server', 'main.mts'))).toBe(true)
  })

  it('is documented under its exact package-relative path', () => {
    const docs = readFileSync(join(packageRoot, 'docs', 'mcp-server.md'), 'utf8')
    expect(docs).toContain(`node_modules/vouchington-tooling/${ENTRY}`)
  })
})
