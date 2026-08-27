import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundleDigest, digestEntries } from './digest.mts'

describe('bundleDigest', () => {
  it('streams file contents independently of traversal order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-path-fetch-'))
    try {
      mkdirSync(join(root, 'nested'))
      writeFileSync(join(root, 'nested/a.txt'), 'a')
      writeFileSync(join(root, 'b.txt'), 'b')
      const initial = await bundleDigest(root)
      await expect(bundleDigest(root)).resolves.toBe(initial)
      writeFileSync(join(root, 'b.txt'), 'changed')
      await expect(bundleDigest(root)).resolves.not.toBe(initial)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects symbolic links', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-path-fetch-'))
    try {
      writeFileSync(join(root, 'target'), 'content')
      symlinkSync('target', join(root, 'link'))
      await expect(bundleDigest(root)).rejects.toThrow('symbolic link')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('makes ordering irrelevant and detects metadata entry tampering', () => {
    const entries = [
      { destination: 'b', mode: '0644', sha256: 'b'.repeat(64) },
      { destination: 'a', mode: '0644', sha256: 'a'.repeat(64) },
    ]
    expect(digestEntries(entries)).toBe(digestEntries([...entries].reverse()))
    expect(digestEntries(entries)).not.toBe(
      digestEntries([{ ...entries[0]!, sha256: 'c'.repeat(64) }, entries[1]!]),
    )
  })
})
