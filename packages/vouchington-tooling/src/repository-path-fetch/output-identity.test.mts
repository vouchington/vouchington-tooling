import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { moveAtomic } from './output-identity.mts'

describe('moveAtomic', () => {
  it('removes an exclusive file link when source cleanup fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-output-identity-'))
    try {
      const source = join(root, 'source')
      const destination = join(root, 'destination')
      writeFileSync(source, 'content')
      const failure = new Error('source cleanup failed')
      await expect(
        moveAtomic(source, destination, async () => {
          throw failure
        }),
      ).rejects.toBe(failure)
      expect(readFileSync(source, 'utf8')).toBe('content')
      expect(existsSync(destination)).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('preserves directory modes under a restrictive umask', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-output-identity-'))
    const previousUmask = process.umask(0o077)
    try {
      const source = join(root, 'source')
      const nested = join(source, 'nested')
      const destination = join(root, 'destination')
      mkdirSync(nested, { recursive: true })
      chmodSync(source, 0o755)
      chmodSync(nested, 0o751)
      writeFileSync(join(nested, 'file'), 'content')
      await moveAtomic(source, destination)
      expect(statSync(destination).mode & 0o777).toBe(0o755)
      expect(statSync(join(destination, 'nested')).mode & 0o777).toBe(0o751)
    } finally {
      process.umask(previousUmask)
      rmSync(root, { force: true, recursive: true })
    }
  })
})
