import { describe, expect, it } from 'vitest'
import { dirs, format, topDirs } from './format.mts'

describe('retrospective fact formatting', () => {
  it('uses unavailable defaults for omitted optional fields', () => {
    expect(
      format(
        {
          fetch: 'git fetch',
          fetchStatus: 'ok',
          fetchNote: 'refreshed',
          branch: 'topic',
          state: 'OPEN',
          merged: 'no',
          commits: '1',
          files: '1',
          dirs: 'src',
        },
        '',
      ),
    ).toContain('PR: unavailable')
  })

  it('formats empty paths and null API entries safely', () => {
    expect(topDirs('')).toBe('none')
    expect(dirs({ files: [null] })).toBe('none')
  })
})
