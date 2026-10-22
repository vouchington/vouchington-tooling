import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareRows, parseBaseline, reconcileBaseline, rowsFromReport } from './baseline.mts'

const finding = {
  category: 'unused-symbol',
  path: 'src/example.mts',
  parent: '',
  name: 'unused',
  symbolKind: 'function',
}

function report(findings: unknown[], files = 1, unparsed = 0): unknown {
  return { statistics: { files, unparsed }, findings }
}

describe('jscpd dead-code baseline', () => {
  it('uses a multiset of stable finding identities, independent of line and message changes', () => {
    const current = rowsFromReport(
      report([
        { ...finding, start: { line: 8 }, message: 'first' },
        { ...finding, start: { line: 17 }, message: 'second' },
      ]),
    )
    expect(current).toEqual([{ ...finding, count: 2 }])
    expect(compareRows(current, [{ ...finding, count: 1 }]).added).toEqual(current)
    expect(compareRows([{ ...finding, count: 1 }], current).stale).toEqual(current)
  })

  it('rejects empty, incomplete, and malformed analyzer output', () => {
    expect(() => rowsFromReport(report([], 0))).toThrow('analyzed no files')
    expect(() => rowsFromReport(report([], 1, 1))).toThrow('unparsed files')
    expect(() => rowsFromReport({ statistics: { files: 1, unparsed: 0 } })).toThrow(
      'no findings array',
    )
    expect(() => rowsFromReport(report([{ ...finding, path: '../escape.mts' }]))).toThrow(
      'Invalid report path',
    )
  })

  it('rejects baseline count inflation, duplicate identities, and unsorted records', () => {
    expect(() => parseBaseline({ version: 1, findings: [{ ...finding, count: 0 }] })).toThrow(
      'Invalid dead-code baseline count',
    )
    expect(() =>
      parseBaseline({
        version: 1,
        findings: [
          { ...finding, count: 1 },
          { ...finding, count: 1 },
        ],
      }),
    ).toThrow('duplicate identities')
    expect(() =>
      parseBaseline({
        version: 1,
        findings: [
          { ...finding, path: 'z.mts', count: 1 },
          { ...finding, path: 'a.mts', count: 1 },
        ],
      }),
    ).toThrow('not sorted')
  })

  it('seeds only once, refuses new findings without writing, and updates only after a shrink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jscpd-baseline-test-'))
    const path = join(directory, 'baseline.json')
    const original = [{ ...finding, count: 2 }]
    try {
      await reconcileBaseline(path, original, 'seed')
      const first = await readFile(path, 'utf8')
      await expect(reconcileBaseline(path, original, 'seed')).rejects.toThrow('already exists')
      await expect(reconcileBaseline(path, [{ ...finding, count: 3 }], 'update')).rejects.toThrow(
        'New dead-code findings',
      )
      expect(await readFile(path, 'utf8')).toBe(first)
      await expect(reconcileBaseline(path, [{ ...finding, count: 1 }], 'check')).rejects.toThrow(
        'Stale dead-code baseline',
      )
      expect(await reconcileBaseline(path, [{ ...finding, count: 1 }], 'update')).toBe(1)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        version: 1,
        findings: [{ ...finding, count: 1 }],
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
