import { describe, expect, it } from 'vitest'
import { countFiles } from './count.mts'
import { fakeScc, layoutConfig, SCC_HEADER, sccCsv, tempRepo } from './layout.test-helpers.mts'

const repo = tempRepo({
  'api/a.ts': 'a',
  'api/fixtures/f.ts': 'f',
  'docs/guide.md': 'g',
  'untracked-elsewhere/x.ts': 'x',
})

describe('countFiles', () => {
  it('keeps tracked, counted, non-ignored rows from scc output', async () => {
    const scc = fakeScc(
      sccCsv({
        './api/a.ts': 7,
        'api/fixtures/f.ts': 9,
        'docs/guide.md': 2,
        'untracked-elsewhere/x.ts': 4,
        'api/not-tracked.ts': 4,
      }),
    )
    const files = await countFiles(layoutConfig(), { cwd: repo, sccBin: scc })
    expect(files).toEqual([
      { path: 'api/a.ts', code: 7 },
      { path: 'docs/guide.md', code: 2 },
    ])
  })

  it('resolves the binary from the env, then the config', async () => {
    const out = sccCsv({ 'api/a.ts': 1 })
    const env = { SCC_BIN: fakeScc(out) }
    expect(await countFiles(layoutConfig(), { cwd: repo, env })).toHaveLength(1)
    const config = layoutConfig({ sccBin: fakeScc(out) })
    expect(await countFiles(config, { cwd: repo, env: {} })).toHaveLength(1)
  })

  it('passes no exclude flag when no directories are excluded', async () => {
    const config = layoutConfig({ excludedDirs: [] })
    expect(await countFiles(config, { cwd: repo, sccBin: fakeScc(SCC_HEADER) })).toEqual([])
  })

  it('explains a missing binary with the configured hint', async () => {
    const config = layoutConfig({ missingSccHint: 'Run the installer.' })
    await expect(countFiles(config, { cwd: repo, sccBin: '/nonexistent/scc' })).rejects.toThrow(
      'scc is required but "/nonexistent/scc" was not found. Run the installer.',
    )
    await expect(
      countFiles(layoutConfig(), { cwd: repo, sccBin: '/nonexistent/scc' }),
    ).rejects.toThrow(/was not found\.$/u)
  })

  it('fails when scc exits non-zero', async () => {
    const scc = fakeScc(sccCsv({ 'api/a.ts': 1 }), 3)
    await expect(countFiles(layoutConfig(), { cwd: repo, sccBin: scc })).rejects.toThrow(
      'scc exited with status 3',
    )
  })

  it.each([
    ['too few fields', 'TypeScript,api/a.ts\n'],
    ['blank code', 'TypeScript,api/a.ts,a,1, ,0,0,0,0\n'],
    ['non-numeric code', 'TypeScript,api/a.ts,a,1,many,0,0,0,0\n'],
    ['missing path', 'TypeScript,,a,1,1,0,0,0,0\n'],
    ['empty line', '\n'],
  ])('rejects an invalid record: %s', async (_name, row) => {
    const scc = fakeScc(SCC_HEADER + row)
    await expect(countFiles(layoutConfig(), { cwd: repo, sccBin: scc })).rejects.toThrow(
      'Invalid CSV record from scc',
    )
  })
})
