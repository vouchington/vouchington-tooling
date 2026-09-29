import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../mcp-server/run.mts', () => ({ runMcpServer: vi.fn() }))

import { runMcpServer } from '../../mcp-server/run.mts'
import { readInstalledVersion } from '../installed-version.mts'
import { runMcpCommand } from './mcp.mts'

describe('vouchington mcp command', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  afterEach(() => {
    stderr.mockClear()
    stdout.mockClear()
    vi.mocked(runMcpServer).mockReset()
  })

  it('serves from the launch cwd with the installed version and exits 0 once connected', async () => {
    vi.mocked(runMcpServer).mockResolvedValue(undefined)
    await expect(runMcpCommand([])).resolves.toBe(0)
    expect(runMcpServer).toHaveBeenCalledWith({
      cwd: process.cwd(),
      env: process.env,
      version: readInstalledVersion(),
    })
    expect(stderr).not.toHaveBeenCalled()
    expect(stdout).not.toHaveBeenCalled()
  })

  it('rejects arguments without starting the server', async () => {
    await expect(runMcpCommand(['--file', 'x'])).resolves.toBe(1)
    expect(runMcpServer).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('usage: vouchington mcp'))
  })

  it('reports startup failures on stderr and never on stdout', async () => {
    vi.mocked(runMcpServer).mockRejectedValueOnce(new Error('needs @modelcontextprotocol/sdk'))
    await expect(runMcpCommand([])).resolves.toBe(1)
    expect(stderr).toHaveBeenCalledWith('needs @modelcontextprotocol/sdk\n')
    vi.mocked(runMcpServer).mockRejectedValueOnce('plain failure')
    await expect(runMcpCommand([])).resolves.toBe(1)
    expect(stderr).toHaveBeenLastCalledWith('plain failure\n')
    expect(stdout).not.toHaveBeenCalled()
  })
})
