import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const plugins = new URL('../../../plugins/', import.meta.url)
const manifests = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugin.json']

it('registers no MCP server in any plugin; registration is per machine', async () => {
  const names = (await readdir(plugins, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  expect(names).toContain('vouchington-workflow')
  for (const name of names) {
    const root = fileURLToPath(new URL(`${name}/`, plugins))
    const entries = await readdir(root)
    expect(entries).not.toContain('.mcp.json')
    expect(entries).not.toContain('mcp.json')
    for (const manifest of manifests) {
      const text = await readFile(`${root}${manifest}`, 'utf8').catch(() => '{}')
      expect(JSON.parse(text)).not.toHaveProperty('mcpServers')
    }
  }
})
