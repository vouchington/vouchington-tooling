import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeScc, LAYOUT, sccCsv, tempRepo } from '../../cloc/layout.test-helpers.mts'
import { runClocCommand } from './cloc.mts'

afterEach(() => vi.restoreAllMocks())

function capture() {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true))
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true))
  return { out, err }
}

function setup() {
  const repo = tempRepo({ 'api/a.ts': 'a', 'api/a.test.ts': 'b' })
  const configFile = join(mkdtempSync(join(tmpdir(), 'cloc-cli-')), 'layout.json')
  writeFileSync(configFile, JSON.stringify(LAYOUT))
  vi.spyOn(process, 'cwd').mockReturnValue(repo)
  return { configFile, scc: fakeScc(sccCsv({ 'api/a.ts': 8, 'api/a.test.ts': 2 })) }
}

describe('runClocCommand', () => {
  it('prints the table and exits 0', async () => {
    const { configFile, scc } = setup()
    const { out, err } = capture()
    await expect(runClocCommand(['--config', configFile, '--scc-bin', scc], {})).resolves.toBe(0)
    expect(out.join('')).toContain('api           8      2        0     10')
    expect(err.join('')).toBe('')
  })

  it('prints rows as JSON with --json and honors SCC_BIN', async () => {
    const { configFile, scc } = setup()
    const { out } = capture()
    await expect(
      runClocCommand(['--config', configFile, '--json'], { SCC_BIN: scc }),
    ).resolves.toBe(0)
    const rows = JSON.parse(out.join('')) as { service: string; total: number }[]
    expect(rows.at(-1)).toMatchObject({ service: 'total', total: 10 })
  })

  it('exits 2 with usage when --config is missing or a flag is unknown', async () => {
    const { err } = capture()
    await expect(runClocCommand([], {})).resolves.toBe(2)
    await expect(runClocCommand(['--nope'], {})).resolves.toBe(2)
    expect(err.join('')).toContain('--config <file> is required')
    expect(err.join('')).toContain('cloc --config <file>')
  })

  it('exits 1 when the config cannot load or counting fails', async () => {
    const { configFile } = setup()
    const { err } = capture()
    await expect(runClocCommand(['--config', '/nonexistent/layout.json'], {})).resolves.toBe(1)
    await expect(
      runClocCommand(['--config', configFile, '--scc-bin', '/nonexistent/scc'], {}),
    ).resolves.toBe(1)
    expect(err.join('')).toContain('was not found')
  })

  it('reports a non-Error failure', async () => {
    const { configFile } = setup()
    const { err } = capture()
    const load = vi.fn().mockRejectedValue('boom')
    await expect(runClocCommand(['--config', 'layout.mts'], {}, load)).resolves.toBe(1)
    expect(err.join('')).toContain('boom')
    expect(configFile).toBeTruthy()
  })
})
