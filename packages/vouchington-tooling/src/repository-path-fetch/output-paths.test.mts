import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateOutputPaths } from './output-paths.mts'

describe('validateOutputPaths', () => {
  it.each([
    ['/tmp/bundle', '/tmp/bundle'],
    ['/tmp/bundle', '/tmp/bundle/metadata'],
    ['/tmp/bundle/nested', '/tmp/bundle'],
    ['/tmp/bundle', '/tmp/.bundle.fetch-incomplete'],
  ])('rejects overlapping output paths %s and %s', (destination, metadata) => {
    expect(() => validateOutputPaths(destination, metadata)).toThrow(
      'destination and metadata overlap',
    )
  })

  it('accepts distinct normalized absolute paths', () => {
    expect(() =>
      validateOutputPaths(join('/tmp', 'bundle'), join('/tmp', 'metadata.json')),
    ).not.toThrow()
  })

  it('rejects overlap through a symlinked existing ancestor', () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-output-paths-'))
    try {
      const real = join(root, 'real')
      const link = join(root, 'link')
      mkdirSync(real)
      symlinkSync(real, link)
      expect(() =>
        validateOutputPaths(join(real, 'bundle'), join(link, 'bundle', 'metadata.json')),
      ).toThrow('destination and metadata overlap')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects case-only missing suffix overlap according to volume semantics', () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-output-paths-'))
    try {
      const probe = join(root, 'case-probe')
      mkdirSync(probe)
      const caseInsensitive = existsSync(join(root, 'CASE-PROBE'))
      const validate = () =>
        validateOutputPaths(
          join(root, 'CaseDir', 'bundle'),
          join(root, 'casedir', 'bundle', 'metadata.json'),
        )
      if (caseInsensitive) expect(validate).toThrow('destination and metadata overlap')
      else expect(validate).not.toThrow()
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
