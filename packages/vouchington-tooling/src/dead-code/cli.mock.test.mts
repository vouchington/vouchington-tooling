import { describe, expect, it, vi } from 'vitest'
import { runDeadCodeCli } from './cli.mts'

vi.mock('./gate.mts', () => ({
  runDeadCodeGate: vi.fn().mockRejectedValue('plain failure'),
}))

describe('runDeadCodeCli with a non-Error rejection', () => {
  it('prints the stringified value and exits 1', async () => {
    const output = { error: vi.fn(), log: vi.fn() }
    expect(await runDeadCodeCli(['--baseline', 'b.json'], output)).toBe(1)
    expect(output.error).toHaveBeenCalledWith('plain failure')
  })
})
