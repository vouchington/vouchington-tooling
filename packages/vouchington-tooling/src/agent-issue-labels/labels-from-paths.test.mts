import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { labelsFromPaths } from './labels-from-paths.mts'

const LABELER = [
  'backend:',
  '  - changed-files:',
  "      - any-glob-to-any-file: 'backend/**'",
  'queues:',
  '  - changed-files:',
  '      - any-glob-to-any-file:',
  "          - 'backend/queues/**'",
  "          - 'workers/**'",
  'docs:',
  '  - changed-files:',
  "      - 'docs/**/*.md'",
  'no-rules: not-an-array',
  'empty:',
  '  - something-else: true',
  '',
].join('\n')

describe('labelsFromPaths', () => {
  let dir: string
  let labelerPath: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'labels-from-paths-'))
    labelerPath = join(dir, 'labeler.yml')
    await writeFile(labelerPath, LABELER)
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('matches single globs, glob lists, and plain string entries', async () => {
    expect(await labelsFromPaths(['backend/queues/a.ts'], labelerPath)).toEqual([
      'backend',
      'queues',
    ])
    expect(await labelsFromPaths(['workers/x.ts'], labelerPath)).toEqual(['queues'])
    expect(await labelsFromPaths(['docs/guide/a.md'], labelerPath)).toEqual(['docs'])
  })

  it('returns each label once and nothing for unmatched paths', async () => {
    expect(await labelsFromPaths(['backend/a.ts', 'backend/b.ts'], labelerPath)).toEqual([
      'backend',
    ])
    expect(await labelsFromPaths(['unknown/file.txt'], labelerPath)).toEqual([])
    expect(await labelsFromPaths([], labelerPath)).toEqual([])
  })

  it('returns no labels for a missing, empty, or non-mapping config', async () => {
    expect(await labelsFromPaths(['a'], join(dir, 'missing.yml'))).toEqual([])
    const empty = join(dir, 'empty.yml')
    await writeFile(empty, '')
    expect(await labelsFromPaths(['a'], empty)).toEqual([])
    const bad = join(dir, 'bad.yml')
    await writeFile(bad, 'a: [unclosed')
    expect(await labelsFromPaths(['a'], bad)).toEqual([])
  })
})
