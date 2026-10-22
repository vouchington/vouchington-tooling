import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseBaseline,
  readBaseline,
  reconcileBaseline,
  rowsFromReport,
  writeBaseline,
} from './baseline.mts'

const finding = { category: 'unused-file', path: 'a.mts', name: '' }

function report(findings: unknown[]): unknown {
  return { statistics: { files: 1, unparsed: 0 }, findings }
}

describe('dead-code baseline validation', () => {
  it('rejects non-object documents and wrong versions', () => {
    for (const value of [null, [], 'text', 1]) {
      expect(() => rowsFromReport(value)).toThrow('Expected a JSON object')
    }
    expect(() => parseBaseline({ version: 2, findings: [] })).toThrow('version or findings')
    expect(() => parseBaseline({ version: 1 })).toThrow('version or findings')
  })

  it('rejects malformed finding identities', () => {
    expect(() => rowsFromReport(report([{ ...finding, category: 'other' }]))).toThrow(
      'Unknown dead-code category',
    )
    expect(() => rowsFromReport(report([{ ...finding, name: 3 }]))).toThrow(
      'Expected name to be a string',
    )
    expect(() => rowsFromReport(report([{ ...finding, path: '' }]))).toThrow('Invalid report path')
    expect(() => rowsFromReport(report([{ ...finding, path: '/abs.mts' }]))).toThrow(
      'Invalid report path',
    )
    expect(() => rowsFromReport(report([{ ...finding, path: 'a\\b.mts' }]))).toThrow(
      'Invalid report path',
    )
    expect(() => rowsFromReport(report([{ ...finding, parent: 1 }]))).toThrow(
      'Expected parent to be a string',
    )
  })

  it('defaults parent and symbolKind, and applies the include filter', () => {
    const rows = rowsFromReport(
      report([finding, { ...finding, path: 'b.mts' }]),
      (found) => found.path === 'a.mts',
    )
    expect(rows).toEqual([{ ...finding, parent: '', symbolKind: '', count: 1 }])
  })

  it('round-trips a baseline through disk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dead-code-baseline-io-'))
    try {
      const path = join(directory, 'baseline.json')
      const rows = [{ ...finding, parent: '', symbolKind: '', count: 2 }]
      await writeBaseline(path, rows)
      expect(await readBaseline(path)).toEqual(rows)
      await writeFile(path, '{"version":1,"findings":[{"category":"unused-file"}]}')
      await expect(readBaseline(path)).rejects.toThrow('Expected path to be a string')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('summarizes long finding lists and named symbols', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dead-code-baseline-describe-'))
    try {
      const path = join(directory, 'baseline.json')
      await writeBaseline(path, [])
      const many = Array.from({ length: 14 }, (_, index) => ({
        category: 'unused-export',
        path: `f${String(index).padStart(2, '0')}.mts`,
        parent: index === 0 ? 'Box' : '',
        name: index < 2 ? 'thing' : '',
        symbolKind: '',
        count: 1,
      }))
      const failure = reconcileBaseline(path, many, 'check')
      await expect(failure).rejects.toThrow('unused-export f00.mts Box.thing (1)')
      await expect(failure).rejects.toThrow('f01.mts thing (1)')
      await expect(failure).rejects.toThrow('…and 2 more identities')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
