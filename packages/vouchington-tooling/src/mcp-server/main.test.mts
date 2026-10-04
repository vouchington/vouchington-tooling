import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../cli/commands/mcp.mts', () => ({ runMcpCommand: vi.fn() }))

import { runMcpCommand } from '../cli/commands/mcp.mts'
import { runMcpMain } from './main.mts'

describe('runMcpMain', () => {
  const previous = process.exitCode
  afterEach(() => {
    process.exitCode = previous
    vi.mocked(runMcpCommand).mockReset()
  })

  it('starts the server with no arguments and records the exit code', async () => {
    vi.mocked(runMcpCommand).mockResolvedValueOnce(0)
    await runMcpMain()
    expect(runMcpCommand).toHaveBeenCalledWith([])
    expect(process.exitCode).toBe(0)
    vi.mocked(runMcpCommand).mockResolvedValueOnce(1)
    await runMcpMain()
    expect(process.exitCode).toBe(1)
  })
})
