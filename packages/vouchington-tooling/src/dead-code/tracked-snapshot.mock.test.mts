import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => Buffer.from('../escape.mts\0ok.mts\0ok.mts\0')),
}))

const { copyTrackedWorkingTree, trackedPaths } = await import('./tracked-snapshot.mts')

describe('tracked path validation', () => {
  it('de-duplicates git output', () => {
    expect(trackedPaths('/repo')).toEqual(['../escape.mts', 'ok.mts'])
  })

  it('refuses a listed path that leaves the repository', async () => {
    await expect(copyTrackedWorkingTree(process.cwd(), '/tmp/dead-code-never')).rejects.toThrow(
      'Tracked path escapes the repository: ../escape.mts',
    )
  })
})
