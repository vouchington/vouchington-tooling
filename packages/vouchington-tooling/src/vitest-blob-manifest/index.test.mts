import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createVitestBlobManifest,
  inspectVitestBlobBundle,
  parseVitestBlobManifest,
  serializeVitestBlobManifest,
  VITEST_BLOB_MANIFEST_FILENAME,
  vitestBlobBundlePaths,
  writeVitestBlobManifest,
  type VitestBlobIdentity,
} from './index.mts'

const identity: VitestBlobIdentity = {
  suite: 'backend-shard-1',
  repository: 'owner/repo',
  revision: 'a'.repeat(40),
  runId: '9131',
  runAttempt: 2,
}

describe('Vitest blob manifest', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vitest-manifest-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function bundle(name = 'bundle', report = Buffer.from('{"ok":true}\n')): string {
    const directory = join(root, name)
    mkdirSync(directory)
    writeFileSync(join(directory, `${identity.suite}.json`), report)
    writeVitestBlobManifest(directory, identity)
    return directory
  }

  it('stamps a deterministic manifest bound to one report', () => {
    const first = bundle('first')
    const second = bundle('second')
    const inspected = inspectVitestBlobBundle(first)

    expect(inspected.manifest).toEqual({
      version: 'vitest-blob-manifest:v1',
      suite: identity.suite,
      repository: identity.repository,
      revision: identity.revision,
      run: { id: identity.runId, attempt: identity.runAttempt },
      report: {
        filename: `${identity.suite}.json`,
        byteLength: 12,
        sha256: 'e5f1eb4d806641698a35efe20e098efd20d7d57a9b90ee69079d5bb650920726',
      },
    })
    expect(readFileSync(join(first, VITEST_BLOB_MANIFEST_FILENAME))).toEqual(
      readFileSync(join(second, VITEST_BLOB_MANIFEST_FILENAME)),
    )
    expect(inspected.reportBytes.toString()).toBe('{"ok":true}\n')
  })

  it('accepts only the exact v1 schema and identity formats', () => {
    const valid = createVitestBlobManifest(identity, Buffer.from('{}'))
    expect(parseVitestBlobManifest(valid)).toEqual(valid)
    const invalid: unknown[] = [
      Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'revision')),
      { ...valid, extra: true },
      { ...valid, version: 'vitest-blob-manifest:v2' },
      { ...valid, suite: '../backend' },
      { ...valid, repository: 'not-a-repo' },
      { ...valid, revision: 'A'.repeat(40) },
      { ...valid, run: { ...valid.run, id: '0' } },
      { ...valid, run: { ...valid.run, attempt: 0 } },
      { ...valid, run: { ...valid.run, extra: true } },
      { ...valid, report: { ...valid.report, filename: 'other.json' } },
      { ...valid, report: { ...valid.report, sha256: 'a'.repeat(63) } },
      { ...valid, report: { ...valid.report, extra: true } },
    ]
    for (const raw of invalid) {
      expect(() => parseVitestBlobManifest(raw)).toThrow('invalid schema')
    }
  })

  it('rejects a report whose size or digest does not match', () => {
    const sizeMismatch = bundle('size')
    writeFileSync(join(sizeMismatch, `${identity.suite}.json`), 'longer report')
    expect(() => inspectVitestBlobBundle(sizeMismatch)).toThrow('integrity check failed')

    const digestMismatch = bundle('digest', Buffer.from('same-size'))
    writeFileSync(join(digestMismatch, `${identity.suite}.json`), 'different')
    expect(() => inspectVitestBlobBundle(digestMismatch)).toThrow('integrity check failed')
  })

  it('rejects missing, extra, symlinked, and non-file bundle entries', () => {
    const missing = join(root, 'missing')
    mkdirSync(missing)
    writeFileSync(join(missing, VITEST_BLOB_MANIFEST_FILENAME), '{}')
    expect(() => inspectVitestBlobBundle(missing)).toThrow('exactly two files')

    const extra = bundle('extra')
    writeFileSync(join(extra, 'extra.txt'), 'unowned')
    expect(() => inspectVitestBlobBundle(extra)).toThrow('exactly two files')

    const symlink = bundle('symlink')
    rmSync(join(symlink, `${identity.suite}.json`))
    symlinkSync(join(extra, `${identity.suite}.json`), join(symlink, `${identity.suite}.json`))
    expect(() => inspectVitestBlobBundle(symlink)).toThrow('exactly two files')

    const directory = bundle('directory')
    rmSync(join(directory, `${identity.suite}.json`))
    mkdirSync(join(directory, `${identity.suite}.json`))
    expect(() => inspectVitestBlobBundle(directory)).toThrow('exactly two files')
  })

  it('writes a manifest atomically without packaging unrelated report diagnostics', () => {
    const directory = join(root, 'source')
    mkdirSync(directory)
    mkdirSync(join(directory, 'diagnostics'))
    writeFileSync(join(directory, 'diagnostics', 'fork.json'), '{}')
    writeFileSync(join(directory, `${identity.suite}.json`), '{}')

    const manifestPath = writeVitestBlobManifest(directory, identity)
    expect(vitestBlobBundlePaths(directory, identity.suite)).toEqual([
      manifestPath,
      join(directory, `${identity.suite}.json`),
    ])
    expect(readFileSync(join(directory, 'diagnostics', 'fork.json'), 'utf8')).toBe('{}')
    expect(
      serializeVitestBlobManifest(createVitestBlobManifest(identity, Buffer.from('{}'))),
    ).toEqual(readFileSync(manifestPath))

    const missing = join(root, 'missing-source')
    mkdirSync(missing)
    expect(() => writeVitestBlobManifest(missing, identity)).toThrow('Expected exactly one')

    expect(() => writeVitestBlobManifest(missing, { ...identity, suite: '../../outside' })).toThrow(
      'Invalid Vitest suite',
    )

    const multiple = join(root, 'multiple-source')
    mkdirSync(multiple)
    writeFileSync(join(multiple, `${identity.suite}.json`), '{}')
    writeFileSync(join(multiple, 'other.json'), '{}')
    expect(() => writeVitestBlobManifest(multiple, identity)).toThrow('Expected exactly one')
  })
})
