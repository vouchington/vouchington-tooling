import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const stateScript = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../plugins/vouchington-workflow/skills/triage-loop/scripts/state.py',
)
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A temporary root whose config is built from it, and a runner for state.py against that config. */
function setup(config: (root: string) => unknown) {
  const root = mkdtempSync(join(tmpdir(), 'triage-loop-'))
  roots.push(root)
  const path = join(root, 'config.json')
  writeFileSync(path, JSON.stringify(config(root)))
  const run = (...args: string[]) =>
    spawnSync('python3', [stateScript, ...args], {
      encoding: 'utf8',
      env: { ...process.env, TRIAGE_LOOP_CONFIG: path },
    })
  return { root, run }
}

describe('triage-loop state.py', () => {
  it('writes state under the configured directory and bounds the run history', () => {
    const { root, run } = setup((dir) => ({
      stateDir: join(dir, 'state'),
      scheduledPrompts: { history: 2 },
    }))
    expect(run('sweep-done').status).toBe(0)
    for (const id of ['a', 'b', 'c']) {
      const args = ['--prompt', `r:${id}`, '--run-id', id, '--outcome', 'verified no-op']
      expect(run('sp-record', ...args, '--next', 'r:x').status).toBe(0)
    }
    const state = JSON.parse(readFileSync(join(root, 'state', 'state.json'), 'utf8')) as {
      lastSweepAt: string
      scheduledPrompts: { runs: Array<{ runId: string }>; next: string }
    }
    expect(state.lastSweepAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(state.scheduledPrompts.runs.map((entry) => entry.runId)).toEqual(['b', 'c'])
    expect(state.scheduledPrompts.next).toBe('r:x')
  })

  it('stops on a config without a state directory or a field with the wrong shape', () => {
    expect(setup(() => ({})).run('show').stderr).toContain('stateDir must be a string')
    const { root, run } = setup((dir) => ({ stateDir: join(dir, 'state') }))
    expect(run('--help').status).toBe(0)
    expect(run('sweep-done').status).toBe(0)
    writeFileSync(join(root, 'state', 'state.json'), JSON.stringify({ shepherds: [] }))
    const result = run('shepherd', '--pr', 'o/r#1')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('shepherds must be dict')
  })
})
