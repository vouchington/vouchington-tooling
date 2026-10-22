import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonl, tempDir, writeLines } from '../../sandbox-command-audit/fixtures.test-helpers.mts'
import { runSandboxCommandAuditCommand } from './sandbox-command-audit.mts'

afterEach(() => vi.restoreAllMocks())

function capture() {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true))
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true))
  return { out, err }
}

function transcripts() {
  const base = tempDir()
  writeLines(join(base, 'projects', 'p', 'a.jsonl'), jsonl({ type: 'system', cwd: '/repo' }))
  return [
    '--projects-dir',
    join(base, 'projects'),
    '--codex-sessions-dir',
    join(base, 's'),
    '--repo-root',
    '/repo',
  ]
}

describe('runSandboxCommandAuditCommand', () => {
  it('prints the report and exits 0', async () => {
    const { out } = capture()
    const load = async () => ({ default: { loadPolicy: () => ({ covers: () => false }) } })
    const code = await runSandboxCommandAuditCommand(
      ['--rules', 'r.mjs', ...transcripts()],
      {},
      load,
    )
    expect(code).toBe(0)
    expect(out.join('')).toContain('=== Sandbox Command Audit ===')
    expect(out.join('')).toContain('Scanned 1 Claude transcript file(s)')
  })

  it('exits 2 with the usage on a bad flag', async () => {
    const { err } = capture()
    expect(await runSandboxCommandAuditCommand(['--limit', '0'], {})).toBe(2)
    expect(err.join('')).toContain('vouchington: --rules <module> is required')
    expect(err.join('')).toContain('sandbox-command-audit --rules <module>')
  })

  it('exits 1 when the rules module cannot load', async () => {
    const { err } = capture()
    const load = async () => ({ default: {} })
    expect(
      await runSandboxCommandAuditCommand(['--rules', 'r.mjs', ...transcripts()], {}, load),
    ).toBe(1)
    expect(err.join('')).toContain('must export an object with a loadPolicy function')
  })

  it('stringifies a thrown non-Error and loads real modules by default', async () => {
    const { err } = capture()
    const load = async () => {
      throw 'plain'
    }
    expect(
      await runSandboxCommandAuditCommand(['--rules', 'r.mjs', ...transcripts()], {}, load),
    ).toBe(1)
    expect(err.join('')).toContain('vouchington: plain')
    const missing = await runSandboxCommandAuditCommand([
      '--rules',
      join(tempDir(), 'none.mjs'),
      ...transcripts(),
    ])
    expect(missing).toBe(1)
  })
})
