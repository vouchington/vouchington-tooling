import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Hosts may start plugins outside the consumer project. The project is explicit in that case.
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const worktree = process.env.MCP_WORKTREE ?? (process.cwd() !== pluginRoot ? process.cwd() : '')
try {
  if (!worktree || !isAbsolute(worktree))
    throw new Error(
      'Set MCP_WORKTREE to the absolute consuming git worktree in the host environment',
    )
  const consumer = createRequire(join(worktree, 'package.json'))
  const manifestPath = consumer.resolve('vouchington-tooling/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const cli = resolve(dirname(manifestPath), manifest.bin.vouchington)
  process.chdir(worktree)
  const { runCli } = await import(pathToFileURL(cli).href)
  process.exitCode = await runCli([process.execPath, cli, 'mcp'])
} catch (error) {
  process.stderr.write(`Workflow MCP: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
