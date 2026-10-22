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

  it('matches dot-directories and dotfiles like actions/labeler', async () => {
    const dotted = join(dir, 'dotted.yml')
    await writeFile(
      dotted,
      ['ci:', '  - changed-files:', "      - any-glob-to-any-file: '.github/**'", ''].join('\n'),
    )
    expect(await labelsFromPaths(['.github/workflows/ci.yml'], dotted)).toEqual(['ci'])
    const star = join(dir, 'star.yml')
    await writeFile(
      star,
      ['yaml:', '  - changed-files:', "      - any-glob-to-any-file: '**/*.yml'", ''].join('\n'),
    )
    expect(await labelsFromPaths(['.github/workflows/ci.yml'], star)).toEqual(['yaml'])
  })

  it('returns no labels for a missing config', async () => {
    expect(await labelsFromPaths(['a'], join(dir, 'missing.yml'))).toEqual([])
  })

  it('rethrows other read errors', async () => {
    await expect(labelsFromPaths(['a'], dir)).rejects.toThrow('EISDIR')
  })

  it('throws with the path for a YAML syntax error', async () => {
    const bad = join(dir, 'bad.yml')
    await writeFile(bad, 'a: [unclosed')
    await expect(labelsFromPaths(['a'], bad)).rejects.toThrow(`invalid labeler config ${bad}:`)
  })

  it.each([
    ['empty', ''],
    ['scalar', 'just text'],
    ['list', '- a\n- b'],
  ])('throws with the path for a non-mapping %s config', async (name, content) => {
    const file = join(dir, `${name}.yml`)
    await writeFile(file, content)
    await expect(labelsFromPaths(['a'], file)).rejects.toThrow(
      `invalid labeler config ${file}: top level must be a mapping`,
    )
  })
})
