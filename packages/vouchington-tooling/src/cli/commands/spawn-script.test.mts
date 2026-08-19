import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../index.mts'
import { packageScriptPath } from '../script-path.mts'
import { runScript } from './spawn-script.mts'

describe('script dispatch', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    stdout.mockClear()
    stderr.mockClear()
  })

  it('resolves packaged scripts from the package root', () => {
    expect(packageScriptPath('scripts/gha/check-needs-results.sh')).toBe(
      join(process.cwd(), 'packages/vouchington-tooling/scripts/gha/check-needs-results.sh'),
    )
  })

  it('returns the child status and maps a missing status to 1', () => {
    expect(runScript('bash', 'script.sh', ['a'], () => ({ status: 0 }))).toBe(0)
    expect(runScript('bash', 'script.sh', [], () => ({ status: null }))).toBe(1)
  })

  it('surfaces spawn errors', () => {
    expect(() =>
      runScript('bash', 'script.sh', [], () => ({
        error: new Error('spawn failed'),
        status: null,
      })),
    ).toThrow('spawn failed')
  })

  it('runs gha-needs-results through the CLI', () => {
    const previous = process.env.RESULTS
    process.env.RESULTS = '{"job":{"result":"success"}}'
    try {
      expect(runCli(['node', 'vouchington', 'gha-needs-results'])).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.RESULTS
      else process.env.RESULTS = previous
    }
  })
})
