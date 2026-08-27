import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareStagedFile } from './staged-path.mts'

describe('prepareStagedFile', () => {
  it('returns a file below a real staged parent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-stage-'))
    try {
      await expect(prepareStagedFile(root, 'nested/file')).resolves.toBe(join(root, 'nested/file'))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects a staged parent symlink that escapes the bundle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-stage-'))
    const outside = mkdtempSync(join(tmpdir(), 'repository-stage-outside-'))
    try {
      mkdirSync(join(root, 'nested'))
      symlinkSync(outside, join(root, 'nested/link'))
      await expect(prepareStagedFile(root, 'nested/link/created/file')).rejects.toThrow(
        'symbolic link in bundle',
      )
      expect(existsSync(join(outside, 'created'))).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
      rmSync(outside, { force: true, recursive: true })
    }
  })

  it('rejects a non-directory staged parent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-stage-'))
    try {
      writeFileSync(join(root, 'file'), 'not a directory')
      await expect(prepareStagedFile(root, 'file/child')).rejects.toThrow(
        'non-directory bundle parent',
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects a parent that resolves outside the staged root after creation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-stage-'))
    const outside = mkdtempSync(join(tmpdir(), 'repository-stage-outside-'))
    try {
      const realpathPath = async (path: string) => (path === root ? root : outside)
      await expect(prepareStagedFile(root, 'nested/file', realpathPath)).rejects.toThrow(
        'symbolic link in bundle',
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
      rmSync(outside, { force: true, recursive: true })
    }
  })
})
