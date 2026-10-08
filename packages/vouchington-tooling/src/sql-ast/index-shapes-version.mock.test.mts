import { readFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { extractIndexShapes } from './index-shapes.mts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, readFile: vi.fn(original.readFile) }
})

afterEach(() => vi.mocked(readFile).mockReset())

it.each(['0.78.0', '0.81.0-rc.1', 'invalid', '0.81'])(
  'rejects incompatible peer %s',
  async (version) => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ version }))
    await expect(extractIndexShapes('CREATE INDEX idx ON sample (id)')).rejects.toThrow(
      'extractIndexShapes requires no-mistakes >=0.81.0',
    )
  },
)

it.each(['0.81.0', '0.81.0+build.1', '0.81.1-rc.1', '0.82.0', '1.0.0'])(
  'accepts compatible peer %s',
  async (version) => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ version }))
    expect(await extractIndexShapes('CREATE INDEX idx ON sample (id)')).toHaveLength(1)
  },
)
